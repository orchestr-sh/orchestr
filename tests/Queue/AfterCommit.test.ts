/**
 * after_commit dispatch tests
 *
 * Queue connections honour `after_commit`: jobs dispatched while a
 * database transaction is open are only pushed once the outermost
 * transaction commits, and are dropped when it rolls back. The
 * transaction system is resolved through the driver's own connection
 * (DatabaseDriver) or the container's default `db` binding.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { TransactionAwareConnection } from '@/Queue/Contracts/QueueDriver';
import { CacheManager } from '@/Cache/CacheManager';
import { ArrayStore } from '@/Cache/Stores/ArrayStore';
import { Application } from '@/Foundation/Application';
import { Job } from '@/Queue/Job';
import { QueueManager } from '@/Queue/QueueManager';
import { Facade } from '@/Support/Facade';
import { TestQueueDriver } from './support/TestQueueDriver';

/**
 * Minimal transaction system double mirroring Database\Connection's
 * afterCommit semantics: run-now when idle, queue when open, drain on
 * commit, discard on rollback.
 */
class FakeTransactionConnection implements TransactionAwareConnection {
  public level = 0;
  public pending: Array<() => any> = [];

  getTransactionLevel(): number {
    return this.level;
  }

  async afterCommit(callback: () => any): Promise<void> {
    if (this.level === 0) {
      await callback();
      return;
    }

    this.pending.push(callback);
  }

  begin(): void {
    this.level += 1;
  }

  async commit(): Promise<void> {
    this.level = Math.max(0, this.level - 1);

    if (this.level === 0) {
      const callbacks = this.pending;
      this.pending = [];

      for (const callback of callbacks) {
        await callback();
      }
    }
  }

  rollback(): void {
    this.level = Math.max(0, this.level - 1);

    if (this.level === 0) {
      this.pending = [];
    }
  }
}

class AfterCommitJob extends Job {
  async handle(): Promise<void> {}
}

class DeferredJob extends Job {
  async handle(): Promise<void> {}
}

describe('after_commit queue dispatch', () => {
  let app: Application;
  let manager: QueueManager;
  let driver: TestQueueDriver;
  let connection: FakeTransactionConnection;

  beforeEach(() => {
    app = new Application('/test');
    Facade.setFacadeApplication(app);

    connection = new FakeTransactionConnection();
    driver = new TestQueueDriver();
    driver.transactionConnection = connection;

    manager = new QueueManager(
      {
        default: 'test',
        connections: {
          test: { driver: 'test', queue: 'default' },
          deferred: { driver: 'test', queue: 'default', after_commit: true },
        },
      },
      app
    );

    manager.registerDriver('test', () => driver);
    app.instance('queue', manager);
  });

  afterEach(() => {
    Facade.clearResolvedInstances();
    Facade.setFacadeApplication(undefined as any);
  });

  it('does not make the job visible before the transaction commits', async () => {
    const job = new AfterCommitJob();
    job.afterCommit = true;

    connection.begin();

    const id = await manager.dispatch(job);
    expect(id).toBe(job.uuid);

    // Not visible while the transaction is open
    expect(await driver.size()).toBe(0);
    expect(driver.jobs).toHaveLength(0);

    await connection.commit();

    // Visible afterwards
    expect(await driver.size()).toBe(1);
    expect(driver.jobs[0].id).toBe(job.uuid);
  });

  it('discards the job when the transaction rolls back', async () => {
    const job = new AfterCommitJob();
    job.afterCommit = true;

    connection.begin();
    await manager.dispatch(job);

    connection.rollback();
    expect(await driver.size()).toBe(0);

    // And a later unrelated commit does not resurrect it
    connection.begin();
    await connection.commit();
    expect(await driver.size()).toBe(0);
  });

  it('dispatches immediately when no transaction is open', async () => {
    const job = new AfterCommitJob();
    job.afterCommit = true;

    await manager.dispatch(job);

    expect(await driver.size()).toBe(1);
  });

  it('honours the after_commit connection config without a job-level flag', async () => {
    const job = new DeferredJob();
    job.connection = 'deferred';

    connection.begin();
    await manager.dispatch(job);
    expect(await driver.size()).toBe(0);

    await connection.commit();
    expect(await driver.size()).toBe(1);
  });

  it('waits for the outermost transaction of nested levels', async () => {
    const job = new AfterCommitJob();
    job.afterCommit = true;

    connection.begin();
    connection.begin();

    await manager.dispatch(job);

    await connection.commit(); // inner commit: still open
    expect(await driver.size()).toBe(0);

    await connection.commit(); // outer commit: flushes
    expect(await driver.size()).toBe(1);
  });

  it('routes the fluent PendingDispatch.afterCommit() through the transaction system', async () => {
    connection.begin();

    const id = await AfterCommitJob.dispatch(1).afterCommit();

    expect(await driver.size()).toBe(0);

    await connection.commit();

    expect(await driver.size()).toBe(1);
    expect(driver.jobs[0].id).toBe(id);
  });

  it('falls back to the container db connection when the driver exposes none', async () => {
    const plainDriver = new TestQueueDriver();
    // Simulate a driver without its own transaction system (e.g. Redis)
    plainDriver.getTransactionConnection = () => null;

    const fallbackManager = new QueueManager(
      {
        default: 'plain',
        connections: { plain: { driver: 'plain', queue: 'default' } },
      },
      app
    );

    fallbackManager.registerDriver('plain', () => plainDriver);
    app.instance('db', { connection: () => connection });

    const job = new AfterCommitJob();
    job.afterCommit = true;

    connection.begin();
    await fallbackManager.dispatch(job);
    expect(await plainDriver.size()).toBe(0);

    await connection.commit();
    expect(await plainDriver.size()).toBe(1);
  });

  it('still dispatches normally when no transaction system exists at all', async () => {
    const plainDriver = new TestQueueDriver();
    plainDriver.getTransactionConnection = () => null;

    const standaloneManager = new QueueManager({
      default: 'plain',
      connections: { plain: { driver: 'plain', queue: 'default' } },
    });
    standaloneManager.registerDriver('plain', () => plainDriver);

    const job = new AfterCommitJob();
    job.afterCommit = true;

    await standaloneManager.dispatch(job);

    expect(await plainDriver.size()).toBe(1);
  });

  it('never shows a deferred unique job before commit but keeps its lock', async () => {
    class UniqueDeferred extends Job {
      public uniqueFor = 60;
      public override afterCommit = true;

      uniqueId(): string {
        return 'deferred-unique';
      }
      async handle(): Promise<void> {}
    }

    const cacheManager = new CacheManager({
      default: 'array',
      prefix: '',
      stores: { array: { driver: 'array' } },
    });
    cacheManager.registerDriver('array', () => new ArrayStore());
    app.instance('cache', cacheManager);

    // Route through the real unique-lock path with the shared transaction stub
    const uniqueManager = new QueueManager(
      { default: 'test', connections: { test: { driver: 'test', queue: 'default' } } },
      app
    );
    uniqueManager.registerDriver('test', () => driver);

    connection.begin();

    await uniqueManager.dispatch(new UniqueDeferred());
    await uniqueManager.dispatch(new UniqueDeferred());

    // The lock acquired at dispatch suppresses the duplicate even though
    // neither job is visible before the commit.
    expect(await driver.size()).toBe(0);

    await connection.commit();

    expect(await driver.size()).toBe(1);
  });
});
