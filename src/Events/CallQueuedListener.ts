import { Job } from '@/Queue/Job';
import { Facade } from '@/Support/Facade';
import type { ListenerInterface } from './types';
/**
 * CallQueuedListener Job
 *
 * Queue payload that carries a single queued event listener. The dispatcher
 * pushes one of these instead of invoking a `ShouldQueue` listener inline;
 * the worker deserializes it, resolves the original listener, restores the
 * event from its serialized form, and calls `handle()` with it.
 *
 * Mirrors Laravel's `Illuminate\Queue\CallQueuedListener`.
 *
 * @example
 * ```typescript
 * const job = CallQueuedListener.fromEvent('SendWelcomeEmail', new UserRegistered(user));
 * await queue.push(job);
 * ```
 */
import { Event } from './Event';
import { resolveRegisteredListener } from './ListenerRegistry';

export class CallQueuedListener extends Job {
  constructor(
    /** Listener class name / discovery path resolved by the worker */
    public handler: string = '',
    public eventClass: string | null = null,
    public eventName: string | null = null,
    public eventData: Record<string, any> | null = null,
    public eventArgs: any[] = []
  ) {
    super();
  }

  /**
   * Build the job for a listener handler and the event that triggered it
   *
   * @param handler - Listener class name / discovery path
   * @param event - Event instance or event name being dispatched
   * @param args - Extra payload arguments passed to the listener
   * @returns Configured CallQueuedListener job
   */
  static fromEvent(handler: string, event: any, args: any[] = []): CallQueuedListener {
    const job = new CallQueuedListener(handler);

    if (typeof event === 'string') {
      job.eventName = event;
      job.eventArgs = CallQueuedListener.safeJson(args);
      return job;
    }

    job.eventClass = event?.constructor?.name ?? null;
    job.eventData = CallQueuedListener.serializeEvent(event);
    job.eventArgs = CallQueuedListener.safeJson(args);

    return job;
  }

  /**
   * Get the display name of the job
   */
  displayName(): string {
    return `CallQueuedListener@${this.handler}`;
  }

  /**
   * Resolve the listener and invoke it with the restored event
   */
  async handle(): Promise<void> {
    const listener = this.resolveListener() as ListenerInterface;
    await listener.handle(this.restoreEvent() as Event);
  }

  /**
   * Notify the listener of a failure, mirroring the ShouldQueue contract
   */
  async failed(error: Error): Promise<void> {
    try {
      const listener = this.resolveListener() as any;

      if (typeof listener.failed === 'function') {
        await listener.failed(this.restoreEvent(), error);
      }
    } catch {
      // Best effort: never mask the original job failure with resolution noise
    }
  }

  /**
   * Resolve the handler back to a listener instance
   *
   * Prefers the in-process listener registry (populated by `listen()` and
   * discovery) and falls back to container bindings registered for the name.
   */
  protected resolveListener(): object {
    const registered = resolveRegisteredListener(this.handler);

    if (registered !== undefined && typeof registered !== 'string') {
      if (typeof registered === 'function' && (registered as any).prototype?.handle) {
        return new (registered as unknown as new (...args: any[]) => object)();
      }
      if (typeof registered === 'function') {
        throw new Error(`Closure listener [${this.handler}] cannot be restored from the queue`);
      }
      return registered as object;
    }

    const app = Facade.getFacadeApplication() as any;

    if (app?.bound?.(this.handler)) {
      const resolved = app.make(this.handler);

      // A binding may hand back the class itself; instantiate it so callers
      // always receive an object with a bound `handle` method.
      if (typeof resolved === 'function' && (resolved as any).prototype?.handle) {
        return new (resolved as unknown as new (...args: any[]) => object)();
      }

      return resolved as object;
    }

    throw new Error(
      `Queued listener [${this.handler}] could not be resolved. ` +
        'Import the listener module or bind it in the container so the worker can restore it.'
    );
  }

  /**
   * Restore the event from its serialized form
   *
   * Uses the Event class registry to rebuild a typed instance; falls back to
   * a plain object snapshot for non-Event payload classes (e.g. model events)
   * so listeners that only read properties keep working.
   */
  protected restoreEvent(): any {
    if (this.eventName !== null && this.eventName !== undefined) {
      return this.eventName;
    }

    const data = this.eventData ?? {};

    if (this.eventClass) {
      const eventClass = Event.registeredClass(this.eventClass) as any;

      if (eventClass && typeof eventClass.fromJSON === 'function') {
        return eventClass.fromJSON(data);
      }
    }

    const { _class: _ignored, ...rest } = data;
    return CallQueuedListener.deserializeRestored(rest);
  }

  /**
   * Serialize an event instance into a JSON-safe record
   */
  protected static serializeEvent(event: any): Record<string, any> | null {
    if (event === null || event === undefined) {
      return null;
    }

    if (typeof event.toJSON === 'function') {
      return CallQueuedListener.safeJson([event.toJSON()])[0];
    }

    return CallQueuedListener.safeJson([{ ...event }])[0];
  }

  /**
   * Rehydrate Date markers produced by `Event.serializeValue`
   */
  protected static deserializeRestored(value: any): any {
    if (value === null || typeof value !== 'object') {
      return value;
    }

    // Values restored through `Job.fromJSON` are already rehydrated
    if (value instanceof Date) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => CallQueuedListener.deserializeRestored(item));
    }

    if (value._type === 'Date') {
      return new Date(value.value);
    }

    const restored: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      restored[key] = CallQueuedListener.deserializeRestored(val);
    }

    return restored;
  }

  /**
   * Round-trip a value through JSON so non-serializable members fail early
   */
  protected static safeJson<T>(value: T): T {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      throw new Error(`CallQueuedListener: event payload is not queue-serializable (${(error as Error).message})`);
    }
  }
}
