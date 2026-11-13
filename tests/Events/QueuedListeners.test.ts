/**
 * Queued listener tests
 *
 * Listeners implementing the ShouldQueue contract - or registered with the
 * `queued` flag - are pushed through the queue manager as CallQueuedListener
 * jobs instead of running inline. The worker restores both the listener and
 * the event, and `ShouldDispatchAfterCommit` events / `afterCommit` listeners
 * wait for the active transaction to commit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ShouldDispatchAfterCommit } from '@/Events/Contracts/ShouldDispatchAfterCommit';
import type { QueueDriver, QueueDriverJob } from '@/Queue/Contracts/QueueDriver';
import { Container } from '@/Container/Container';
import { CallQueuedListener } from '@/Events/CallQueuedListener';
import { Dispatcher } from '@/Events/Dispatcher';
import { Event } from '@/Events/Event';
import { clearListenerRegistry } from '@/Events/ListenerRegistry';
import { isShouldQueue, type ShouldQueue } from '@/Listeners/Contracts/ShouldQueue';
import { Job } from '@/Queue/Job';
import { JobPayload } from '@/Queue/JobPayload';
import { QueueManager } from '@/Queue/QueueManager';
import { Facade } from '@/Support/Facade';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

class OrderPlaced extends Event {
  constructor(
    public readonly orderId: number,
    public readonly shippedAt: Date = new Date('2026-01-01T00:00:00.000Z')
  ) {
    super();
  }
}

class CheckoutCompleted extends Event implements ShouldDispatchAfterCommit {
  public readonly shouldDispatchAfterCommit = true;

  constructor(public readonly orderId: number) {
    super();
  }
}

/** Queued via the ShouldQueue configuration properties */
class NotifyCustomer implements ShouldQueue {
  static handled: Event[] = [];

  public readonly queued = true;
  public queue = 'notifications';
  public tries = 3;
  public timeout = 45;

  async handle(event: Event): Promise<void> {
    NotifyCustomer.handled.push(event);
  }

  async failed(): Promise<void> {
    /* noop */
  }
}

/** Queued via the `queued` registration flag only */
class PlainFlaggedListener {
  static handled: Event[] = [];

  handle(event: Event): void {
    PlainFlaggedListener.handled.push(event);
  }
}

/** Queue configuration without the explicit marker - structurally ShouldQueue */
class StructuralQueued implements ShouldQueue {
  static handled: Event[] = [];

  public queue = 'default';

  async handle(event: Event): Promise<void> {
    StructuralQueued.handled.push(event);
  }
}

/** Queued marker with a runtime opt-out for small orders */
class SometimesQueued implements ShouldQueue {
  static handled: Event[] = [];
  static pushedInline = false;

  public readonly queued = true;

  shouldQueue(event: any): boolean {
    return (event as OrderPlaced).orderId > 100;
  }

  async handle(event: Event): Promise<void> {
    SometimesQueued.handled.push(event);
  }
}

/** ShouldQueueAfterCommit-style listener: queued, but only post-commit */
class AuditAfterCommit implements ShouldQueue {
  static handled: Event[] = [];

  public readonly queued = true;
  public readonly afterCommit = true;

  async handle(event: Event): Promise<void> {
    AuditAfterCommit.handled.push(event);
  }
}

/**
 * Queue driver that records pushed jobs instead of executing them, mirroring
 * what a real driver would persist for a separate worker process.
 */
class RecordingDriver implements QueueDriver {
  public pushed: Job[] = [];
  public pushedLater: Array<{ delay: number | Date; job: Job }> = [];
  protected connectionName = 'recording';

  async size(): Promise<number> {
    return this.pushed.length;
  }

  async push(job: Job): Promise<string> {
    this.pushed.push(job);
    return job.uuid;
  }

  async pushRaw(): Promise<string> {
    throw new Error('not used');
  }

  async later(delay: number | Date, job: Job): Promise<string> {
    this.pushedLater.push({ delay, job });
    return this.push(job);
  }

  async bulk(jobs: Job[]): Promise<void> {
    this.pushed.push(...jobs);
  }

  async pop(): Promise<QueueDriverJob | null> {
    return null;
  }

  async release(): Promise<void> {}
  async delete(): Promise<void> {}
  async clear(): Promise<number> {
    return 0;
  }

  getConnectionName(): string {
    return this.connectionName;
  }

  setConnectionName(name: string): void {
    this.connectionName = name;
  }

  getQueue(queue?: string): string {
    return queue || 'default';
  }
}

/**
 * Minimal transaction-aware connection double matching the duck type the
 * dispatcher uses for after-commit deferral.
 */
class FakeTransactionConnection {
  public level = 0;
  public callbacks: Array<() => any> = [];

  async begin(): Promise<void> {
    this.level += 1;
  }

  async commit(): Promise<void> {
    this.level = Math.max(0, this.level - 1);

    if (this.level === 0) {
      const pending = this.callbacks;
      this.callbacks = [];

      for (const callback of pending) {
        await callback();
      }
    }
  }

  async rollback(): Promise<void> {
    this.level = Math.max(0, this.level - 1);

    if (this.level === 0) {
      this.callbacks = [];
    }
  }

  getTransactionLevel(): number {
    return this.level;
  }

  async afterCommit(callback: () => any): Promise<void> {
    if (this.level === 0) {
      await callback();
      return;
    }

    this.callbacks.push(callback);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Queued event listeners', () => {
  let container: Container;
  let dispatcher: Dispatcher;
  let driver: RecordingDriver;
  let queue: QueueManager;
  let connection: FakeTransactionConnection;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearListenerRegistry();
    NotifyCustomer.handled = [];
    PlainFlaggedListener.handled = [];
    StructuralQueued.handled = [];
    SometimesQueued.handled = [];
    SometimesQueued.pushedInline = false;
    AuditAfterCommit.handled = [];

    container = new Container();
    driver = new RecordingDriver();
    queue = new QueueManager({
      default: 'recording',
      connections: { recording: { driver: 'recording' } },
    });
    queue.registerDriver('recording', () => driver);
    container.instance('queue', queue);

    connection = new FakeTransactionConnection();
    container.instance('db', { connection: () => connection });

    dispatcher = new Dispatcher(container);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('ShouldQueue detection', () => {
    it('pushes a queued listener to the queue instead of running it inline', async () => {
      dispatcher.listen(OrderPlaced.name, new NotifyCustomer());

      const responses = await dispatcher.dispatch(new OrderPlaced(1));

      expect(responses).toEqual([]);
      expect(NotifyCustomer.handled).toHaveLength(0);
      expect(driver.pushed).toHaveLength(1);

      const job = driver.pushed[0] as CallQueuedListener;
      expect(job).toBeInstanceOf(CallQueuedListener);
      expect(job.handler).toBe('NotifyCustomer');
      expect(job.queue).toBe('notifications');
      expect(job.tries).toBe(3);
      expect(job.timeout).toBe(45);
    });

    it('honours the explicit queued registration flag', async () => {
      dispatcher.listen(OrderPlaced.name, PlainFlaggedListener, true);

      await dispatcher.dispatch(new OrderPlaced(2));

      expect(PlainFlaggedListener.handled).toHaveLength(0);
      expect(driver.pushed).toHaveLength(1);
      expect((driver.pushed[0] as CallQueuedListener).handler).toBe('PlainFlaggedListener');
    });

    it('detects structural ShouldQueue configuration on instances', async () => {
      dispatcher.listen(OrderPlaced.name, new StructuralQueued());

      await dispatcher.dispatch(new OrderPlaced(3));

      expect(StructuralQueued.handled).toHaveLength(0);
      expect(driver.pushed).toHaveLength(1);
    });

    it('recognises ShouldQueue instances behind string listeners', async () => {
      container.instance('NotifyByString', new NotifyCustomer());
      dispatcher.listen(OrderPlaced.name, 'NotifyByString');

      await dispatcher.dispatch(new OrderPlaced(4));

      expect(NotifyCustomer.handled).toHaveLength(0);
      expect(driver.pushed).toHaveLength(1);
      expect((driver.pushed[0] as CallQueuedListener).handler).toBe('NotifyByString');
    });

    it('keeps the listener inline when shouldQueue(event) opts out', async () => {
      dispatcher.listen(OrderPlaced.name, new SometimesQueued());

      await dispatcher.dispatch(new OrderPlaced(5));

      expect(SometimesQueued.handled).toHaveLength(1);
      expect(driver.pushed).toHaveLength(0);
    });

    it('queues when shouldQueue(event) opts in', async () => {
      dispatcher.listen(OrderPlaced.name, new SometimesQueued());

      await dispatcher.dispatch(new OrderPlaced(500));

      expect(SometimesQueued.handled).toHaveLength(0);
      expect(driver.pushed).toHaveLength(1);
    });

    it('falls back to the event connection, queue, and delay', async () => {
      dispatcher.listen(OrderPlaced.name, PlainFlaggedListener, true);

      const event = new OrderPlaced(6);
      event.connection = 'recording';
      event.queue = 'events';
      event.delay = 30;

      await dispatcher.dispatch(event);

      const job = driver.pushed[0] as CallQueuedListener;
      expect(job.connection).toBe('recording');
      expect(job.queue).toBe('events');
      expect(job.delay).toBe(30);
    });

    it('uses withDelay(event) for the push delay', async () => {
      class Delayed implements ShouldQueue {
        public readonly queued = true;
        withDelay(): number {
          return 120;
        }
        handle(): void {}
      }

      dispatcher.listen(OrderPlaced.name, new Delayed());
      await dispatcher.dispatch(new OrderPlaced(7));

      expect(driver.pushed[0].delay).toBe(120);
    });

    it('rejects queueing a closure listener', async () => {
      dispatcher.listen('test', () => 'never', true);

      await expect(dispatcher.dispatch('test')).rejects.toThrow(/Closure listeners cannot be queued/);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('fails with a clear error when the queue manager is not registered', async () => {
      const bare = new Dispatcher(new Container());
      bare.listen(OrderPlaced.name, new NotifyCustomer());

      await expect(bare.dispatch(new OrderPlaced(8))).rejects.toThrow(/queue manager is not registered/);
    });

    it('treats queued listeners as non-responses in until()', async () => {
      dispatcher.listen('test', new NotifyCustomer());
      dispatcher.listen('test', () => 'sync-answer');

      const result = await dispatcher.until('test');

      expect(result).toBe('sync-answer');
      expect(driver.pushed).toHaveLength(1);
    });

    it('exposes the isShouldQueue type guard for constructors and instances', () => {
      class StaticMarked {
        static readonly queued = true;
        handle(): void {}
      }

      expect(isShouldQueue(StaticMarked)).toBe(true);
      expect(isShouldQueue(new NotifyCustomer())).toBe(true);
      expect(isShouldQueue(() => undefined)).toBe(false);
      expect(isShouldQueue({ handle: () => undefined })).toBe(false);
    });
  });

  describe('worker round trip', () => {
    it('restores the listener and a typed event from the serialized payload', async () => {
      const listener = new NotifyCustomer();
      dispatcher.listen(OrderPlaced.name, listener);

      await dispatcher.dispatch(new OrderPlaced(42));

      // Serialize like a driver would, then process like the Worker does.
      const job = driver.pushed[0];
      const raw = JobPayload.serialize(JobPayload.create(job));
      const payload = JobPayload.deserialize(raw);

      const jobClass = queue.getJobClass(payload.job);
      expect(jobClass).toBe(CallQueuedListener);

      const restored = CallQueuedListener.fromJSON(payload.data);
      await restored.handle();

      expect(NotifyCustomer.handled).toHaveLength(1);
      const event = NotifyCustomer.handled[0] as OrderPlaced;
      expect(event).toBeInstanceOf(OrderPlaced);
      expect(event.orderId).toBe(42);
      expect(event.shippedAt).toBeInstanceOf(Date);
      expect((event.shippedAt as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('restores string-name events for wildcard string listeners', async () => {
      class RecordActivity {
        static seen: any[] = [];
        handle(event: any): void {
          RecordActivity.seen.push(event);
        }
      }

      container.bind('RecordActivity', () => new RecordActivity());
      // String handlers fall back to the container when the job runs.
      Facade.setFacadeApplication(container as any);

      try {
        dispatcher.listen('user.*', 'RecordActivity', true);

        await dispatcher.dispatch('user.created', ['extra']);

        const payload = JobPayload.deserialize(JobPayload.serialize(JobPayload.create(driver.pushed[0])));
        await CallQueuedListener.fromJSON(payload.data).handle();

        expect(RecordActivity.seen).toEqual(['user.created']);
      } finally {
        Facade.setFacadeApplication(undefined as any);
      }
    });

    it('invokes the listener failed handler through the job', async () => {
      const failures: Array<[any, Error]> = [];

      class FailingListener {
        public readonly queued = true;
        handle(): void {
          throw new Error('boom');
        }
        failed(event: any, error: Error): void {
          failures.push([event, error]);
        }
      }

      const listener = new FailingListener();
      dispatcher.listen(OrderPlaced.name, listener);
      await dispatcher.dispatch(new OrderPlaced(9));

      const job = driver.pushed[0] as CallQueuedListener;
      expect(job.displayName()).toBe('CallQueuedListener@FailingListener');

      await job.handle().catch(() => undefined);
      await job.failed(new Error('exhausted'));

      expect(failures).toHaveLength(1);
      expect(failures[0][1].message).toBe('exhausted');
    });
  });

  describe('ShouldDispatchAfterCommit events', () => {
    it('defers dispatch of marked events until the transaction commits', async () => {
      const inline = vi.fn();
      dispatcher.listen(CheckoutCompleted.name, inline);

      await connection.begin();

      const responses = await dispatcher.dispatch(new CheckoutCompleted(11));

      expect(responses).toEqual([]);
      expect(inline).not.toHaveBeenCalled();
      expect(connection.callbacks).toHaveLength(1);

      await connection.commit();

      expect(inline).toHaveBeenCalledTimes(1);
      expect(inline.mock.calls[0][0]).toBeInstanceOf(CheckoutCompleted);
    });

    it('dispatches marked events immediately outside a transaction', async () => {
      const inline = vi.fn();
      dispatcher.listen(CheckoutCompleted.name, inline);

      await dispatcher.dispatch(new CheckoutCompleted(12));

      expect(inline).toHaveBeenCalledTimes(1);
    });

    it('discards deferred dispatches when the transaction rolls back', async () => {
      const inline = vi.fn();
      dispatcher.listen(CheckoutCompleted.name, inline);

      await connection.begin();
      await dispatcher.dispatch(new CheckoutCompleted(13));
      await connection.rollback();

      expect(inline).not.toHaveBeenCalled();
      expect(connection.callbacks).toHaveLength(0);
    });

    it('resolves until() to null while a marked event is deferred', async () => {
      dispatcher.listen(CheckoutCompleted.name, () => false);

      await connection.begin();

      await expect(dispatcher.until(new CheckoutCompleted(14))).resolves.toBeNull();
    });

    it('only pushes after-commit queued listeners once the transaction commits', async () => {
      dispatcher.listen(OrderPlaced.name, new AuditAfterCommit());

      await connection.begin();

      await dispatcher.dispatch(new OrderPlaced(15));

      expect(driver.pushed).toHaveLength(0);
      expect(connection.callbacks).toHaveLength(1);

      await connection.commit();

      expect(driver.pushed).toHaveLength(1);
      const job = driver.pushed[0] as CallQueuedListener;
      expect(job.handler).toBe('AuditAfterCommit');
      expect(job.afterCommit).toBe(true);

      await job.handle();
      expect(AuditAfterCommit.handled).toHaveLength(1);
    });
  });
});
