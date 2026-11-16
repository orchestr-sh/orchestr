/**
 * DbMonitorCommand
 *
 * Report the health of the subsystems a deployment leans on - database,
 * cache, and queue - wherever the application registered them. Mirrors the
 * shape of Laravel's database monitoring commands, extended to "queue/cache/
 * database health where supported" as the operational dashboard needs.
 *
 * The probes live in HealthMonitor; this command runs them, renders the
 * table, and fails the run when a supported subsystem is unhealthy.
 */

import type { HealthCheckResult } from '@/Foundation/Diagnostics/HealthMonitor';
import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { HealthMonitor } from '@/Foundation/Diagnostics/HealthMonitor';

export class DbMonitorCommand extends Command {
  signature = 'db:monitor {--database= : The database connection to check}';
  description = 'Report the health of the database, cache, and queue connections';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[] = [], options: CommandOptions = {}): Promise<void> {
    await this.app.boot();

    const monitor = new HealthMonitor(this.app);
    const connectionName = typeof options.database === 'string' ? options.database : undefined;

    const results = await monitor.check({ database: connectionName });

    this.info('Database Monitor');
    this.newLine();
    this.table(
      ['Check', 'Status', 'Details'],
      results.map((result) => [result.name, renderStatus(result), result.detail])
    );

    const failed = results.filter((result) => result.status === 'fail');

    if (failed.length > 0) {
      this.newLine();
      this.error(`${failed.length} of ${results.length} health checks failed.`);
      throw new Error(`${failed.length} of ${results.length} health checks failed.`);
    }

    if (results.length === 0) {
      this.newLine();
      this.comment('No database, cache, or queue services are registered; nothing to monitor.');
    }
  }
}

function renderStatus(result: HealthCheckResult): string {
  switch (result.status) {
    case 'ok':
      return 'OK';
    case 'fail':
      return 'FAIL';
    default:
      return 'SKIP';
  }
}
