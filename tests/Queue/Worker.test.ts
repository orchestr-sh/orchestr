/**
 * Worker reliability tests
 *
 * Covers the middleware pipeline (every middleware runs exactly once, in
 * declaration order, around the job) and timeout handling (timed-out jobs
 * are marked failed, cooperative jobs receive an abort signal, and the
 * timeout timer is cleared on success).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FailedJobProvider } from '@/Queue/Failed/FailedJobProvider';
import type { Job as JobContract } from '@/Queue/Job';
import type { JobMiddleware } from '@/Queue/Middleware/JobMiddleware';
import { Application } from '@/Foundation/Application';
import { TimeoutExceededException } from '@/Queue/Exceptions/TimeoutExceededException';
import { Job } from '@/Queue/Job';
import { QueueManager } from '@/Queue/QueueManager';
import { Worker } from '@/Queue/Workers/Worker';
import { TestQueueDriver } from './support/TestQueueDriver';

const trace: string[] = [];

/** Records its invocation order and that it received the actual job */
class TracingMiddleware implements JobMiddleware {
  constructor(protected name: string) {}

  async handle(job: JobContract, next: () => Promise<void>): Promise<void> {
    trace.push(`${this.name}:pre`);
    trace.push(`${this.name}:seesJob:${job instanceof PipelineJob}`);
    await next();
    trace.push(`${this.name}:post`);
  }
}

class PipelineJob extends Job {
  public tries = 3;
  public timeout = 5;

  async handle(): Promise<void> {
    trace.push('job');
  }

  middleware(): JobMiddleware[] {
    return [new TracingMiddleware('A'), new TracingMiddleware('B'), new TracingMiddleware('C')];
  }
}

class PlainJob extends Job {
  public timeout = 5;

  async handle(): Promise<void> {
    trace.push('plain-job');
  }
}

class HangingJob extends Job {
  /** More attempts than one run so old release-and-retry behaviour is distinguishable */
  public tries = 5;
  public timeout = 0.05; // 50ms

  static failure: Error | null = null;

  async handle(): Promise<void> {
    // Non-cooperative: ignores cancellation and keeps running past the deadline
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  async failed(error: Error): Promise<void> {
    HangingJob.failure = error;
  }
}

class CooperativeJob extends Job {
  public tries = 5;
  public timeout = 0.05; // 50ms

  static sawAbort = false;
  static signalArgWasSignal = false;

  async handle(signal?: AbortSignal): Promise<void> {
    CooperativeJob.signalArgWasSignal = signal instanceof AbortSignal;

    await new Promise<void>((resolve) => {
      if (!signal) {
        resolve();
        return;
      }

      if (signal.aborted) {
        resolve();
        return;
      }

      signal.addEventListener('abort', () => {
        CooperativeJob.sawAbort = true;
        resolve();
      });

      // Would finish long after the timeout if the signal were ignored
      const timer = setTimeout(resolve, 5000);
      signal.addEventListener('abort', () => clearTimeout(timer));
    });
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

describe('Worker middleware pipeline', () => {
  let driver: TestQueueDriver;
  let manager: QueueManager;
  let worker: Worker;

  beforeEach(async () => {
    trace.length = 0;

    const app = new Application('/test');
    manager = new QueueManager({
      default: 'test',
      connections: { test: { driver: 'test', queue: 'default' } },
    });

    driver = new TestQueueDriver();
    manager.registerDriver('test', () => driver);
    manager.registerJob(PipelineJob.name, PipelineJob);
    manager.registerJob(PlainJob.name, PlainJob);

    app.instance('queue.failer', createFailerStub());
    worker = new Worker(manager, app);

    await manager.dispatch(new PipelineJob());
  });

  it('runs every middleware exactly once, in declaration order, around the job', async () => {
    await worker.runOnce('test', 'default');

    expect(trace).toEqual([
      'A:pre',
      'A:seesJob:true',
      'B:pre',
      'B:seesJob:true',
      'C:pre',
      'C:seesJob:true',
      'job',
      'C:post',
      'B:post',
      'A:post',
    ]);
  });

  it('passes the job instance (not another middleware) to each middleware', async () => {
    await worker.runOnce('test', 'default');

    // Each middleware reported `job instanceof PipelineJob` as its first argument
    expect(trace.filter((entry) => entry.endsWith(':seesJob:true'))).toHaveLength(3);
    expect(trace.filter((entry) => entry.includes(':seesJob:'))).toHaveLength(3);
  });

  it('deletes the job after the pipeline completes', async () => {
    await worker.runOnce('test', 'default');

    expect(driver.jobs).toHaveLength(0);
    expect(driver.deleted).toHaveLength(1);
  });
});

describe('Worker timeout handling', () => {
  let driver: TestQueueDriver;
  let manager: QueueManager;
  let worker: Worker;
  let failer: FailedJobProvider & { log: ReturnType<typeof vi.fn> };
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const app = new Application('/test');
    manager = new QueueManager({
      default: 'test',
      connections: { test: { driver: 'test', queue: 'default' } },
    });

    driver = new TestQueueDriver();
    manager.registerDriver('test', () => driver);
    manager.registerJob(HangingJob.name, HangingJob);
    manager.registerJob(CooperativeJob.name, CooperativeJob);
    manager.registerJob(PlainJob.name, PlainJob);

    failer = createFailerStub();
    app.instance('queue.failer', failer);
    worker = new Worker(manager, app);

    HangingJob.failure = null;
    CooperativeJob.sawAbort = false;
    CooperativeJob.signalArgWasSignal = false;

    // Silence expected worker noise while keeping the assertions
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('marks a timed-out job failed instead of retrying it', async () => {
    await manager.push(new HangingJob());

    await worker.runOnce('test', 'default');

    // The job was deleted (marked failed), not released back for another attempt
    expect(driver.deleted).toHaveLength(1);
    expect(driver.released).toHaveLength(0);
    expect(driver.jobs).toHaveLength(0);

    // failed() handler ran with the timeout error and the failure was stored
    expect(HangingJob.failure).toBeInstanceOf(TimeoutExceededException);
    expect(failer.log).toHaveBeenCalledTimes(1);
    expect(String(failer.log.mock.calls[0][3])).toContain('timed out');
  });

  it('aborts the cancellation signal for cooperative jobs', async () => {
    await manager.push(new CooperativeJob());

    await worker.runOnce('test', 'default');

    expect(CooperativeJob.signalArgWasSignal).toBe(true);
    expect(CooperativeJob.sawAbort).toBe(true);
    expect(driver.deleted).toHaveLength(1);
  });

  it('clears the timeout timer when the job finishes in time', async () => {
    trace.length = 0;
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    try {
      await manager.push(new PlainJob());
      await worker.runOnce('test', 'default');

      // The job ran (proving the success path completed)...
      expect(trace).toContain('plain-job');
      // ...and the pending timeout timer was cleared instead of leaking
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      trace.length = 0;
      clearSpy.mockRestore();
    }
  });
});

describe('Worker.executeWithTimeout', () => {
  it('runs without a timeout when the value is zero or negative', async () => {
    const app = new Application('/test');
    const manager = new QueueManager({
      default: 'test',
      connections: { test: { driver: 'test', queue: 'default' } },
    });
    const worker = new Worker(manager, app);

    const job = new PlainJob();
    trace.length = 0;

    await (worker as any).executeWithTimeout(job, 0);

    expect(trace).toContain('plain-job');
  });

  it('propagates job errors unchanged when the job fails before the deadline', async () => {
    class ThrowsEarlyJob extends Job {
      public timeout = 5;
      async handle(): Promise<void> {
        throw new Error('early failure');
      }
    }

    const app = new Application('/test');
    const manager = new QueueManager({
      default: 'test',
      connections: { test: { driver: 'test', queue: 'default' } },
    });
    const worker = new Worker(manager, app);

    await expect((worker as any).executeWithTimeout(new ThrowsEarlyJob(), 5)).rejects.toThrow('early failure');
  });
});
