/**
 * Queue workers honour maintenance mode
 *
 * Laravel's contract: a worker on a down application quits (and refuses
 * single jobs) unless it was started with --force, which opts in to
 * running through maintenance. The state is read through Application.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FailedJobProvider } from '@/Queue/Failed/FailedJobProvider';
import { Application } from '@/Foundation/Application';
import { Job } from '@/Queue/Job';
import { QueueManager } from '@/Queue/QueueManager';
import { Worker } from '@/Queue/Workers/Worker';
import { TestQueueDriver } from './support/TestQueueDriver';

let ran = 0;

class MaintenanceJob extends Job {
  async handle(): Promise<void> {
    ran++;
  }
}

function createFailerStub(): FailedJobProvider & { log: ReturnType<typeof vi.fn> } {
  return {
    log: vi.fn(async () => 'failed-1'),
    all: vi.fn(async () => []),
    find: vi.fn(async () => null),
    forget: vi.fn(async () => true),
    flush: vi.fn(async () => undefined),
    count: vi.fn(async () => 0),
  };
}

describe('Worker maintenance mode', () => {
  let base: string;
  let app: Application;
  let driver: TestQueueDriver;
  let manager: QueueManager;
  let worker: Worker;

  beforeEach(async () => {
    ran = 0;
    base = mkdtempSync(join(tmpdir(), 'orchestr-worker-maintenance-'));
    app = new Application(base);

    manager = new QueueManager({
      default: 'test',
      connections: { test: { driver: 'test', queue: 'default' } },
    });

    driver = new TestQueueDriver();
    manager.registerDriver('test', () => driver);
    manager.registerJob(MaintenanceJob.name, MaintenanceJob);

    app.instance('queue.failer', createFailerStub());
    worker = new Worker(manager, app);

    await manager.dispatch(new MaintenanceJob());
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('refuses to take a single job while down', async () => {
    app.maintenanceMode().activate();

    expect(await worker.runOnce('test', 'default')).toBe(false);
    expect(ran).toBe(0);
    expect(await driver.size()).toBe(1);
  });

  it('processes the job anyway with --force', async () => {
    app.maintenanceMode().activate();

    expect(await worker.runOnce('test', 'default', { force: true })).toBe(true);
    expect(ran).toBe(1);
  });

  it('quits the daemon when the application is down', async () => {
    app.maintenanceMode().activate();

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => void logs.push(String(message)));

    try {
      // The daemon loop breaks before touching the driver, so this
      // resolves instead of spinning: reaching here proves the stop
      await worker.daemon('test', 'default');
    } finally {
      logSpy.mockRestore();
    }

    expect(logs.join('\n')).toContain('maintenance mode');
    expect(ran).toBe(0);
    expect(driver.jobs).toHaveLength(1);
  });

  it('keeps the daemon running through maintenance with --force', async () => {
    app.maintenanceMode().activate();

    await worker.daemon('test', 'default', { force: true, stopWhenEmpty: true, sleep: 0 });

    expect(ran).toBe(1);
    expect(driver.jobs).toHaveLength(0);
  });

  it('takes jobs normally while the application is up', async () => {
    expect(await worker.runOnce('test', 'default')).toBe(true);
    expect(ran).toBe(1);
  });
});
