import type { Container } from '@/Container/Container';
import type { ShouldQueue } from '@/Listeners/Contracts/ShouldQueue';
import type { QueueManager } from '@/Queue/QueueManager';
import { isShouldQueue } from '@/Listeners/Contracts/ShouldQueue';
import type { DispatcherContract } from './Contracts/Dispatcher';
import type { Event } from './Event';
import type { EventListener, EventNameOrClass, EventSubscriber, ListenerInterface, RegisteredListener } from './types';
import { CallQueuedListener } from './CallQueuedListener';
import { isShouldDispatchAfterCommit } from './Contracts/ShouldDispatchAfterCommit';
import { registerListener, resolveRegisteredListener } from './ListenerRegistry';

/**
 * Minimal view of the pieces of a database connection this dispatcher needs
 * to defer `ShouldDispatchAfterCommit` events. Duck-typed so the Events
 * subsystem never has to import the Database subsystem at runtime.
 */
interface TransactionAwareConnection {
  getTransactionLevel(): number;
  afterCommit(callback: () => any): void | Promise<void>;
}

interface DatabaseManagerLike {
  connection(name?: string): TransactionAwareConnection;
}

/**
 * Event Dispatcher
 *
 * The core event dispatcher implementation. Manages event listeners,
 * handles wildcard patterns, awaits async listeners in registration order,
 * and routes `ShouldQueue` listeners through the queue system.
 *
 * @example
 * ```typescript
 * const dispatcher = new Dispatcher(container);
 *
 * // Register listeners
 * dispatcher.listen('user.registered', SendWelcomeEmail);
 * dispatcher.listen('user.*', LogUserActivity);
 * dispatcher.listen('user.registered', AuditSignup, true); // queued
 *
 * // Dispatch events (async listeners are awaited in order)
 * await dispatcher.dispatch(new UserRegistered(user));
 * ```
 */
export class Dispatcher implements DispatcherContract {
  /**
   * Registered event listeners (direct event name matches)
   */
  protected listeners: Map<string, RegisteredListener[]> = new Map();

  /**
   * Wildcard event listeners (patterns like 'user.*')
   */
  protected wildcards: Map<string, RegisteredListener[]> = new Map();

  /**
   * Queued events waiting to be flushed
   */
  protected queuedEvents: Map<string, Array<{ payload: any[] }>> = new Map();

  /**
   * Create a new event dispatcher
   *
   * @param container - The service container for resolving listeners
   */
  constructor(protected container: Container) {}

  /**
   * Register an event listener
   *
   * Supports single events, multiple events, and wildcard patterns
   *
   * @param events - Event name(s) or class(es) to listen for
   * @param listener - Listener to invoke when event is dispatched
   * @param queued - Force the listener through the queue instead of running it inline
   */
  listen(events: EventNameOrClass | EventNameOrClass[], listener: EventListener, queued?: boolean): void {
    const eventArray = Array.isArray(events) ? events : [events];
    const entry: RegisteredListener = { listener, queued };

    // Remember class/instance listeners by name so queued jobs pushed from
    // this process can resolve the handler when they run.
    const name = Dispatcher.listenerName(listener);

    if (name) {
      registerListener(name, listener);
    }

    for (const event of eventArray) {
      // Class references resolve to their name, matching `dispatch()`'s
      // use of the constructor name for object events.
      const eventName = typeof event === 'string' ? event : event.name;

      if (eventName.includes('*')) {
        this.setupWildcardListen(eventName, entry);
      } else {
        if (!this.listeners.has(eventName)) {
          this.listeners.set(eventName, []);
        }
        this.listeners.get(eventName)!.push(entry);
      }
    }
  }

  /**
   * Check if an event has any listeners
   *
   * Checks both direct listeners and wildcard matches
   *
   * @param eventName - The event name to check
   * @returns True if the event has listeners
   */
  hasListeners(eventName: string): boolean {
    return this.getListeners(eventName).length > 0;
  }

  /**
   * Register an event subscriber
   *
   * Subscribers can register multiple event listeners at once
   *
   * @param subscriber - The subscriber instance
   */
  subscribe(subscriber: EventSubscriber): void {
    const result = subscriber.subscribe(this);

    // If the subscriber returns a mapping, register those listeners
    if (result && typeof result === 'object') {
      for (const [event, listeners] of Object.entries(result)) {
        const listenerArray = Array.isArray(listeners) ? listeners : [listeners];

        for (const listener of listenerArray) {
          this.listen(event, listener);
        }
      }
    }
  }

  /**
   * Dispatch an event to all listeners
   *
   * Each listener is awaited in registration order before the next one runs:
   * direct listeners first, then wildcard listeners. `ShouldQueue` listeners
   * are pushed onto the queue instead of being called inline and contribute
   * no response. Events implementing `ShouldDispatchAfterCommit` are deferred
   * until the active database transaction commits.
   *
   * @param event - Event name or instance
   * @param payload - Additional arguments to pass to listeners
   * @param halt - Stop dispatching if a listener returns false
   * @returns Promise resolving to the array of results from listeners
   */
  async dispatch(event: string | Event, payload: any[] = [], halt: boolean = false): Promise<any[]> {
    const [eventName, eventInstance] = this.parseEventAndPayload(event, payload);

    // Check if we should broadcast this event (for future broadcasting support)
    if (eventInstance) {
      this.shouldBroadcast(eventInstance, payload);
    }

    // ShouldDispatchAfterCommit events wait for the active transaction to commit
    if (eventInstance && this.shouldDeferUntilCommit(eventInstance)) {
      this.withTransactionConnection((connection) => {
        void connection.afterCommit(async () => {
          await this.dispatch(event, payload, halt).catch((error) => this.reportListenerError(error));
        });
      });

      return [];
    }

    const listeners = this.getListeners(eventName);
    const responses: any[] = [];

    for (const entry of listeners) {
      const response = await this.callListener(entry, eventInstance || eventName, payload);

      // If halting and response is false, stop propagation
      if (halt && response === false) {
        return responses;
      }

      // Collect non-null responses
      if (response !== null && response !== undefined) {
        responses.push(response);
      }
    }

    return responses;
  }

  /**
   * Dispatch an event until a listener returns a non-null response
   *
   * Listeners are awaited one at a time, so async listeners participate
   * correctly: a listener resolving to `false` halts `until()` with `false`.
   * Queued listeners resolve to `null` and never satisfy the stop condition.
   *
   * @param event - Event name or instance
   * @param payload - Additional arguments to pass to listeners
   * @returns Promise resolving to the first non-null response from a listener
   */
  async until(event: string | Event, payload: any[] = []): Promise<any> {
    const [eventName, eventInstance] = this.parseEventAndPayload(event, payload);

    if (eventInstance && this.shouldDeferUntilCommit(eventInstance)) {
      this.withTransactionConnection((connection) => {
        void connection.afterCommit(async () => {
          await this.until(event, payload).catch((error) => this.reportListenerError(error));
        });
      });

      return null;
    }

    const listeners = this.getListeners(eventName);

    for (const entry of listeners) {
      const response = await this.callListener(entry, eventInstance || eventName, payload);

      if (response !== null && response !== undefined) {
        return response;
      }
    }

    return null;
  }

  /**
   * Queue an event for later dispatch
   *
   * @param event - Event name
   * @param payload - Event payload
   */
  push(event: string, payload: any[] = []): void {
    if (!this.queuedEvents.has(event)) {
      this.queuedEvents.set(event, []);
    }

    this.queuedEvents.get(event)!.push({ payload });
  }

  /**
   * Flush (dispatch) all queued events for a specific event name
   *
   * @param event - Event name to flush
   */
  async flush(event: string): Promise<void> {
    const queued = this.queuedEvents.get(event);

    if (!queued || queued.length === 0) {
      return;
    }

    // Dispatch each queued event, awaiting async listeners in order
    for (const { payload } of queued) {
      await this.dispatch(event, payload);
    }

    // Clear the queue for this event
    this.queuedEvents.delete(event);
  }

  /**
   * Remove all listeners for an event
   *
   * @param event - Event name
   */
  forget(event: string): void {
    this.listeners.delete(event);
    this.wildcards.delete(event);
  }

  /**
   * Clear all queued events
   */
  forgetPushed(): void {
    this.queuedEvents.clear();
  }

  /**
   * Get raw listener mappings
   *
   * Includes wildcard patterns keyed by their pattern string, mirroring
   * Laravel's `getRawListeners()` so `event:list` shows every registered
   * listener - manual, discovered, cached, and wildcard.
   *
   * @returns Map of event names to their listeners
   */
  getRawListeners(): Map<string, EventListener[]> {
    const raw = new Map<string, EventListener[]>();

    for (const [event, entries] of this.listeners) {
      raw.set(
        event,
        entries.map((entry) => entry.listener)
      );
    }

    for (const [pattern, entries] of this.wildcards) {
      raw.set(
        pattern,
        entries.map((entry) => entry.listener)
      );
    }

    return raw;
  }

  /**
   * Get all listeners for an event (direct + wildcard matches)
   *
   * Direct listeners run before wildcard listeners; both preserve
   * registration order.
   *
   * @param eventName - The event name
   * @returns Array of registered listener entries
   */
  protected getListeners(eventName: string): RegisteredListener[] {
    const directListeners = this.listeners.get(eventName) || [];
    const wildcardListeners = this.getWildcardListeners(eventName);

    return [...directListeners, ...wildcardListeners];
  }

  /**
   * Setup a wildcard listener
   *
   * @param event - Wildcard pattern (e.g., 'user.*')
   * @param entry - Registered listener entry to invoke
   */
  protected setupWildcardListen(event: string, entry: RegisteredListener): void {
    if (!this.wildcards.has(event)) {
      this.wildcards.set(event, []);
    }

    this.wildcards.get(event)!.push(entry);
  }

  /**
   * Get all wildcard listeners matching an event name
   *
   * @param eventName - The event name to match
   * @returns Array of matching listener entries
   */
  protected getWildcardListeners(eventName: string): RegisteredListener[] {
    const matched: RegisteredListener[] = [];

    for (const [pattern, entries] of this.wildcards) {
      if (this.wildcardMatch(pattern, eventName)) {
        matched.push(...entries);
      }
    }

    return matched;
  }

  /**
   * Check if an event name matches a wildcard pattern
   *
   * Supports patterns like:
   * - 'event.*' - Matches 'event.created', 'event.updated', etc.
   * - 'event.*.action' - Matches 'event.user.action', 'event.post.action', etc.
   * - '*' - Matches everything
   *
   * @param pattern - Wildcard pattern
   * @param eventName - Event name to test
   * @returns True if the pattern matches
   */
  protected wildcardMatch(pattern: string, eventName: string): boolean {
    // Convert wildcard pattern to regex
    // Escape special regex characters except *
    const regexPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(eventName);
  }

  /**
   * Parse event and payload from dispatch arguments
   *
   * @param event - Event name or instance
   * @param payload - Event payload
   * @returns Tuple of [eventName, eventInstance]
   */
  protected parseEventAndPayload(event: string | Event, payload: any[]): [string, Event | null] {
    if (typeof event === 'string') {
      return [event, null];
    }

    // Event is an object
    return [event.constructor.name, event];
  }

  /**
   * Call a single listener with the event and payload
   *
   * The one invocation path for every listener shape (closure, class
   * constructor, instance, string reference), for wildcard and direct
   * registration alike. Async listeners are awaited. `ShouldQueue` listeners
   * are pushed onto the queue instead, contributing no inline response.
   * Errors are reported and then propagated.
   *
   * @param entry - The registered listener entry to call
   * @param event - Event name or instance
   * @param payload - Additional payload arguments
   * @returns Promise resolving to the result from the listener
   */
  protected async callListener(entry: RegisteredListener, event: string | Event, payload: any[]): Promise<any> {
    try {
      const listener = entry.listener;

      // Plain closures are invoked directly; they have no class identity and
      // cannot be serialized onto a queue.
      if (typeof listener === 'function' && !Dispatcher.isListenerClass(listener)) {
        if (entry.queued) {
          throw new Error('Closure listeners cannot be queued; register a class-based listener instead.');
        }

        return await (listener as (...args: any[]) => any)(event, ...payload);
      }

      const instance = this.resolveListenerInstance(listener);

      if (this.shouldQueueListener(entry, instance, event)) {
        await this.queueListener(instance, listener, event, payload);
        return null;
      }

      return await (instance as ListenerInterface).handle(event as any);
    } catch (error) {
      // Report the failure, then propagate it to application-level handling
      this.reportListenerError(error);
      throw error;
    }
  }

  /**
   * Resolve a listener registration into the object that owns `handle()`
   *
   * Mirrors the previous `makeListener` behaviour: class constructors are
   * instantiated per dispatch, object instances are used as-is, and string
   * references resolve from the listener registry / container.
   *
   * @param listener - The registered listener
   * @returns The listener instance exposing `handle`
   */
  protected resolveListenerInstance(listener: EventListener): unknown {
    if (typeof listener === 'string') {
      // Discovery/caching registers classes globally under their path name;
      // fall back to container bindings for app-registered listener strings.
      const registered = resolveRegisteredListener(listener);

      if (registered !== undefined && registered !== listener) {
        return this.resolveListenerInstance(registered);
      }

      return this.container.make<ListenerInterface>(listener);
    }

    if (typeof listener === 'function') {
      return new (listener as unknown as new (...args: any[]) => ListenerInterface)();
    }

    return listener;
  }

  /**
   * Determine whether a resolved listener should be queued instead of called
   *
   * Honours, in order: the explicit `queued` registration flag, the `queued`
   * runtime marker from the `ShouldQueue` contract, and the structural
   * `ShouldQueue` configuration properties. A `shouldQueue(event)` method on
   * the listener can veto queueing at runtime.
   *
   * @param entry - Registered listener entry
   * @param instance - The resolved listener instance
   * @param event - Event name or instance being dispatched
   * @returns True when the listener should go through the queue
   */
  protected shouldQueueListener(
    entry: RegisteredListener,
    instance: unknown,
    event: string | Event
  ): instance is ShouldQueue {
    if (entry.queued) {
      return true;
    }

    // Check the registration (static markers on class constructors) and the
    // resolved instance (declared queue configuration properties).
    const queueable = isShouldQueue(instance) || isShouldQueue(entry.listener);

    if (!queueable) {
      return false;
    }

    // Runtime opt-out: shouldQueue(event) === false keeps the listener inline
    if (
      typeof instance === 'object' &&
      instance !== null &&
      typeof (instance as ShouldQueue).shouldQueue === 'function'
    ) {
      if ((instance as ShouldQueue).shouldQueue!(event as any) === false) {
        return false;
      }
    }

    return instance !== null && instance !== undefined && typeof instance === 'object';
  }

  /**
   * Push a listener invocation onto the queue as a CallQueuedListener job
   *
   * Serializes the event and the listener class name; the worker restores
   * both and calls the listener there. `ShouldQueueAfterCommit` listeners
   * (or `afterCommit`-flagged listeners) wait for the active transaction to
   * commit before their job is pushed.
   *
   * @param instance - The resolved listener instance carrying queue config
   * @param listener - The original registration (for the handler name)
   * @param event - Event name or instance being dispatched
   * @param payload - Additional payload arguments
   */
  protected async queueListener(
    instance: ShouldQueue,
    listener: EventListener,
    event: string | Event,
    payload: any[]
  ): Promise<void> {
    const handler = Dispatcher.listenerName(listener);

    if (!handler) {
      throw new Error('Only class-based listeners can be queued; register a named class or string reference.');
    }

    // Keep the handler resolvable for jobs processed later, in this process.
    registerListener(handler, listener);

    const job = CallQueuedListener.fromEvent(handler, event, payload);
    job.connection = instance.viaConnection?.() ?? instance.connection ?? (event as Event)?.connection;
    job.queue = instance.viaQueue?.() ?? instance.queue ?? (event as Event)?.queue;
    job.tries = instance.tries ?? job.tries;
    job.timeout = instance.timeout ?? job.timeout;
    job.backoff = instance.backoff ?? job.backoff;
    job.delay = instance.withDelay?.(event as Event) ?? instance.delay ?? (event as Event)?.delay;
    job.afterCommit = instance.afterCommit === true;

    if (job.afterCommit) {
      const deferred = this.withTransactionConnection((connection) => {
        if (connection.getTransactionLevel() === 0) {
          return false;
        }

        void connection.afterCommit(async () => {
          await this.pushQueuedListener(job).catch((error) => this.reportListenerError(error));
        });

        return true;
      });

      if (deferred) {
        return;
      }
    }

    await this.pushQueuedListener(job);
  }

  /**
   * Send a queued-listener job to the queue manager
   *
   * @param job - The CallQueuedListener job to push
   */
  protected async pushQueuedListener(job: CallQueuedListener): Promise<void> {
    const manager = this.getQueueManager();

    // The worker restores jobs by class name, so make sure this job type is known.
    manager.registerJob(CallQueuedListener.name, CallQueuedListener);

    await manager.dispatch(job);
  }

  /**
   * Resolve the queue manager from the container
   *
   * @returns The QueueManager instance
   * @throws Error when the queue subsystem is not registered
   */
  protected getQueueManager(): QueueManager {
    if (!this.container.bound('queue')) {
      throw new Error(
        'The queue manager is not registered. Bind the queue service (QueueServiceProvider) ' +
          'before dispatching queued event listeners.'
      );
    }

    return this.container.make<QueueManager>('queue');
  }

  /**
   * Determine whether an event must wait for the active transaction commit
   *
   * @param eventInstance - The event object being dispatched
   * @returns True when the event carries the marker and a transaction is open
   */
  protected shouldDeferUntilCommit(eventInstance: Event): boolean {
    if (!isShouldDispatchAfterCommit(eventInstance)) {
      return false;
    }

    return this.withTransactionConnection((connection) => connection.getTransactionLevel() > 0) === true;
  }

  /**
   * Run a callback against the active database connection when one exists
   *
   * Duck-typed through the container binding `db` so the Events subsystem
   * does not depend on Database at import time.
   *
   * @param callback - Receives the transaction-aware connection, if available
   * @returns The callback result, or null when no database connection exists
   */
  protected withTransactionConnection<T>(callback: (connection: TransactionAwareConnection) => T): T | null {
    if (!this.container.bound('db')) {
      return null;
    }

    try {
      const db = this.container.make<DatabaseManagerLike>('db');
      const connection = db.connection();

      if (typeof connection.getTransactionLevel !== 'function' || typeof connection.afterCommit !== 'function') {
        return null;
      }

      return callback(connection);
    } catch {
      // Database not bootable in this context; dispatch straight through
      return null;
    }
  }

  /**
   * Report a listener failure before propagating it
   *
   * @param error - The error thrown (or promise rejection) from a listener
   */
  protected reportListenerError(error: unknown): void {
    console.error('Error calling event listener:', error);
  }

  /**
   * Check if an event should broadcast
   *
   * This is a placeholder for future broadcasting support
   *
   * @param event - The event instance
   * @param payload - The event payload
   * @returns True if should broadcast
   */
  protected shouldBroadcast(event: Event, payload: any[]): boolean {
    // Check if event has shouldBroadcast method and it returns true
    if (typeof (event as any).shouldBroadcast === 'function') {
      return (event as any).shouldBroadcast();
    }

    // Check if event has broadcastOn method that returns channels
    if (typeof (event as any).broadcastOn === 'function') {
      const channels = (event as any).broadcastOn();
      return Array.isArray(channels) ? channels.length > 0 : !!channels;
    }

    return false;
  }

  /**
   * Derive the stable queue-serializable name of a listener registration
   *
   * @param listener - Registered listener (class, instance, or string)
   * @returns The class name / reference string, or null for closures
   */
  protected static listenerName(listener: EventListener): string | null {
    if (typeof listener === 'string') {
      return listener;
    }

    if (typeof listener === 'function') {
      return listener.name || null;
    }

    if (typeof listener === 'object' && listener !== null) {
      return (listener as object).constructor?.name || null;
    }

    return null;
  }

  /**
   * Determine whether a function listener is a class constructor with handle()
   *
   * @param listener - The function registration to inspect
   * @returns True when it looks like a listener class constructor
   */
  protected static isListenerClass(listener: unknown): boolean {
    return typeof (listener as { prototype?: { handle?: unknown } })?.prototype?.handle === 'function';
  }
}
