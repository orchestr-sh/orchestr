/**
 * ShouldBeUnique enforcement tests
 *
 * Verifies the queue manager acquires a cache lock at dispatch time,
 * suppresses duplicate dispatches while the lock is held, and that the
 * worker releases the lock when the job completes or finally fails -
 * while ShouldBeUniqueUntilProcessing releases it at pop time.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ShouldBeUnique, ShouldBeUniqueUntilProcessing } from '@/Queue/Contracts/ShouldBeUnique';
import type { FailedJobProvider } from '@/Queue/Failed/FailedJobProvider';
import { CacheManager } from '@/Cache/CacheManager';
import { ArrayStore } from '@/Cache/Stores/ArrayStore';
import { Application } from '@/Foundation/Application';
import { SyncDriver } from '@/Queue/Drivers/SyncDriver';
import { Job } from '@/Queue/Job';
import { QueueManager } from '@/Queue/QueueManager';
import { UniqueLock } from '@/Queue/UniqueLock';
import { Worker } from '@/Queue/Workers/Worker';
import { Facade } from '@/Support/Facade';
import { TestQueueDriver } from './support/TestQueueDriver';

class SearchIndexJob extends Job implements ShouldBeUnique {
  public uniqueFor = 60;
  public tries = 3;

  static handled: number[] = [];

  constructor(public productId: number = 1) {
    super();
  }

  uniqueId(): string {
    return `search-${this.productId}`;
  }

  async handle(): Promise<void> {
    SearchIndexJob.handled.push(this.productId);
  }
}

class RetryAfterFailureJob extends Job implements ShouldBeUnique {
  public uniqueFor = 60;
  public tries = 3;
  public backoff = 0;

  uniqueId(): string {
    return 'retry-me';
  }

  async handle(): Promise<void> {
    throw new Error('transient failure');
  }
}

class UntilProcessingJob extends Job implements ShouldBeUniqueUntilProcessing {
  public uniqueUntilProcessing: true = true;
  public uniqueFor = 60;

  static lockPresentDuringHandle: boolean | null = null;

  uniqueId(): string {
    return 'up-1';
  }

  async handle(): Promise<void> {
    const app = Facade.getFacadeApplication();
    const cache = app.make<CacheManager>('cache');

    UntilProcessingJob.lockPresentDuringHandle =
      (await cache.store().get(UniqueLock.keyFor(UntilProcessingJob.name, 'up-1'))) !== null;
  }
}

class SyncUniqueJob extends Job implements ShouldBeUnique {
  public uniqueFor = 60;

  static runCount = 0;

  uniqueId(): string {
    return 'sync-unique';
  }

  async handle(): Promise<void> {
    SyncUniqueJob.runCount++;
  }
}

function createFailerStub(): FailedJobProvider {
  return {
    log: vi.fn(async () => 'failed-1'),
    all: vi.fn(async () => []),
    find: vi.fn(async () => null),
    forget: vi.fn(async () => true),
    flush: vi.fn(async () => undefined),
    count: vi.fn(async () => 0),
  };
}

describe('ShouldBeUnique queue locks', () => {
  let app: Application;
  let cache: CacheManager;
  let manager: QueueManager;
  let driver: TestQueueDriver;
  let worker: Worker;

  const lockValue = async (jobClass: string, uniqueId: string) =>
    cache.store().get<string>(UniqueLock.keyFor(jobClass, uniqueId));

  beforeEach(() => {
    SearchIndexJob.handled = [];
    UntilProcessingJob.lockPresentDuringHandle = null;
    SyncUniqueJob.runCount = 0;

    app = new Application('/test');
    Facade.setFacadeApplication(app);

    cache = new CacheManager({
      default: 'array',
      prefix: '',
      stores: { array: { driver: 'array' } },
    });
    cache.registerDriver('array', () => new ArrayStore());
    app.instance('cache', cache);

    app.instance('queue.failer', createFailerStub());

    manager = new QueueManager(
      {
        default: 'test',
        connections: {
          test: { driver: 'test', queue: 'default' },
          sync: { driver: 'sync' },
        },
      },
      app
    );

    driver = new TestQueueDriver();
    manager.registerDriver('test', () => driver);
    manager.registerDriver('sync', (config) => new SyncDriver(config));

    manager.registerJob(SearchIndexJob.name, SearchIndexJob);
    manager.registerJob(RetryAfterFailureJob.name, RetryAfterFailureJob);
    manager.registerJob(UntilProcessingJob.name, UntilProcessingJob);

    worker = new Worker(manager, app);
  });

  afterEach(() => {
    Facade.clearResolvedInstances();
    Facade.setFacadeApplication(undefined as any);
  });

  it('prevents a duplicate dispatch while a unique job is queued', async () => {
    await manager.dispatch(new SearchIndexJob(7));
    await manager.dispatch(new SearchIndexJob(7));
    await manager.dispatch(new SearchIndexJob(7));

    expect(await manager.connection('test').size()).toBe(1);
    expect(await lockValue(SearchIndexJob.name, 'search-7')).not.toBeNull();
  });

  it('allows a different unique id to queue alongside it', async () => {
    await manager.dispatch(new SearchIndexJob(1));
    await manager.dispatch(new SearchIndexJob(2));

    expect(await manager.connection('test').size()).toBe(2);
  });

  it('releases the lock after the job completes so it can queue again', async () => {
    await manager.dispatch(new SearchIndexJob(5));

    // Duplicate suppressed before processing
    await manager.dispatch(new SearchIndexJob(5));
    expect(await manager.connection('test').size()).toBe(1);

    await worker.runOnce('test', 'default');

    expect(SearchIndexJob.handled).toEqual([5]);
    expect(await lockValue(SearchIndexJob.name, 'search-5')).toBeNull();

    // Now a fresh dispatch is accepted
    await manager.dispatch(new SearchIndexJob(5));
    expect(await manager.connection('test').size()).toBe(1);
  });

  it('keeps the lock when a failed job is released for retry', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await manager.dispatch(new RetryAfterFailureJob());

      await worker.runOnce('test', 'default');

      // Job went back onto the queue for another attempt; lock stays held
      expect(driver.released.length).toBe(1);
      expect(await lockValue(RetryAfterFailureJob.name, 'retry-me')).not.toBeNull();

      await manager.dispatch(new RetryAfterFailureJob());
      expect(await manager.connection('test').size()).toBe(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('releases the lock when the job finally fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await manager.dispatch(new RetryAfterFailureJob());

      // Exhaust all attempts (tries = 3)
      for (let attempt = 0; attempt < 3; attempt++) {
        await worker.runOnce('test', 'default');
      }

      expect(await lockValue(RetryAfterFailureJob.name, 'retry-me')).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('releases the lock at pop time for ShouldBeUniqueUntilProcessing jobs', async () => {
    await manager.dispatch(new UntilProcessingJob());

    expect(await lockValue(UntilProcessingJob.name, 'up-1')).not.toBeNull();

    await worker.runOnce('test', 'default');

    // The job itself observed the lock already gone while it was running
    expect(UntilProcessingJob.lockPresentDuringHandle).toBe(false);
  });

  it('releases the lock immediately for inline (sync) drivers', async () => {
    const syncManager = new QueueManager(
      {
        default: 'sync',
        connections: { sync: { driver: 'sync' } },
      },
      app
    );
    syncManager.registerDriver('sync', (config) => new SyncDriver(config));

    // Two dispatches: with a worker never popping the sync queue, the lock
    // would otherwise leak and block the second dispatch forever.
    await syncManager.dispatch(new SyncUniqueJob());
    await syncManager.dispatch(new SyncUniqueJob());

    expect(SyncUniqueJob.runCount).toBe(2);
  });

  it('throws when dispatching a unique job without the cache subsystem', async () => {
    const bareApp = new Application('/test');
    const bareManager = new QueueManager(
      {
        default: 'test',
        connections: { test: { driver: 'test', queue: 'default' } },
      },
      bareApp
    );
    bareManager.registerDriver('test', () => new TestQueueDriver());

    await expect(bareManager.dispatch(new SearchIndexJob())).rejects.toThrow(/cache subsystem/);
  });

  it('throws when the manager has no container to resolve the cache from', async () => {
    const standalone = new QueueManager({
      default: 'test',
      connections: { test: { driver: 'test', queue: 'default' } },
    });
    standalone.registerDriver('test', () => new TestQueueDriver());

    await expect(standalone.dispatch(new SearchIndexJob())).rejects.toThrow(/application container/);
  });
});
