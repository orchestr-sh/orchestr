/**
 * HealthMonitor
 *
 * The probe suite behind `orchestr db:monitor`: it checks the subsystems a
 * deployment depends on - database connectivity, cache round-trip, and queue
 * reachability - by asking the already-registered managers, never by
 * reimplementing their connection logic.
 *
 * Subsystems that were never registered are reported as `skip`, not `fail`,
 * so a minimal console app still gets a useful, honest report.
 *
 * SRP: this service produces results; the command formats the table.
 */

import type { CacheManager } from '@/Cache/CacheManager';
import type { DatabaseManager } from '@/Database/DatabaseManager';
import type { QueueManager } from '@/Queue/QueueManager';
import { Application } from '@/Foundation/Application';

export type HealthStatus = 'ok' | 'fail' | 'skip';

export interface HealthCheckResult {
  /** Human name of the subsystem, e.g. "Database". */
  name: string;
  status: HealthStatus;
  /** Driver details, the probe measurement, or the failure reason. */
  detail: string;
}

/** A probe run under a name; thrown failures become `fail` results. */
interface HealthProbe {
  name: string;
  check: () => Promise<string> | string;
}

export class HealthMonitor {
  constructor(private app: Application) {}

  /**
   * Run every supported check and return one result per subsystem.
   */
  async check(options: { database?: string } = {}): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];

    for (const probe of this.probes(options)) {
      try {
        results.push({ name: probe.name, status: 'ok', detail: await probe.check() });
      } catch (error) {
        results.push({ name: probe.name, status: 'fail', detail: (error as Error).message });
      }
    }

    return results;
  }

  private probes(options: { database?: string }): HealthProbe[] {
    const probes: HealthProbe[] = [];

    if (this.supported('db')) {
      probes.push({
        name: 'Database',
        check: () => this.checkDatabase(options.database),
      });
    }

    if (this.supported('cache')) {
      probes.push({
        name: 'Cache',
        check: () => this.checkCache(),
      });
    }

    if (this.supported('queue')) {
      probes.push({
        name: 'Queue',
        check: () => this.checkQueue(),
      });
    }

    return probes;
  }

  /**
   * Connectivity: a trivial query through the application's own connection.
   */
  private async checkDatabase(connectionName?: string): Promise<string> {
    const manager = this.app.make<DatabaseManager>('db');
    const name = connectionName ?? manager.getDefaultConnection();
    const connection = manager.connection(name);

    await connection.select('select 1 as health');

    const driver = connection.getConfig()?.driver ?? 'unknown';

    return `connection [${name}] responded (driver: ${driver})`;
  }

  /**
   * Round-trip: write, read back, and forget a probe key.
   */
  private async checkCache(): Promise<string> {
    const manager = this.app.make<CacheManager>('cache');
    const store = manager.store();
    const probeKey = 'orchestr:health:cache';

    await store.forget(probeKey);
    await store.forever(probeKey, 'healthy');
    const value = await store.get<string>(probeKey);
    await store.forget(probeKey);

    if (value !== 'healthy') {
      throw new Error('the cache did not return the probe value');
    }

    return `store [${manager.getDefaultDriver()}] round-tripped`;
  }

  /**
   * Reachability: the default connection answers a queue-depth query.
   */
  private async checkQueue(): Promise<string> {
    const manager = this.app.make<QueueManager>('queue');
    const name = manager.getDefaultConnection();
    const driver = manager.connection(name);
    const config = manager.getConnectionConfig(name);
    const queue = config.queue ?? 'default';

    const size = await driver.size(queue);

    return `connection [${name}] (driver: ${config.driver}) has ${size} pending job(s) on [${queue}]`;
  }

  private supported(name: string): boolean {
    try {
      return this.app.bound(name);
    } catch {
      return false;
    }
  }
}
