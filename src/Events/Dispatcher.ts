import type { Container } from '@/Container/Container';
import type { DispatcherContract } from './Contracts/Dispatcher';
import type { Event } from './Event';
import type { EventListener, EventSubscriber, ListenerInterface } from './types';

/**
 * Event Dispatcher
 *
 * The core event dispatcher implementation. Manages event listeners,
 * handles wildcard patterns, and dispatches events to registered listeners.
 *
 * @example
 * ```typescript
 * const dispatcher = new Dispatcher(container);
 *
 * // Register listeners
 * dispatcher.listen('user.registered', SendWelcomeEmail);
 * dispatcher.listen('user.*', LogUserActivity);
 *
 * // Dispatch events
 * dispatcher.dispatch(new UserRegistered(user));
 * ```
 */
export class Dispatcher implements DispatcherContract {
  /**
   * Registered event listeners (direct event name matches)
   */
  protected listeners: Map<string, EventListener[]> = new Map();

  /**
   * Wildcard event listeners (patterns like 'user.*')
   */
  protected wildcards: Map<string, EventListener[]> = new Map();

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
   * @param events - Event name(s) to listen for
   * @param listener - Listener to invoke when event is dispatched
   */
  listen(events: string | string[], listener: EventListener): void {
    const eventArray = Array.isArray(events) ? events : [events];

    for (const event of eventArray) {
      if (event.includes('*')) {
        this.setupWildcardListen(event, listener);
      } else {
        if (!this.listeners.has(event)) {
          this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(listener);
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
   * @param event - Event name or instance
   * @param payload - Additional arguments to pass to listeners
   * @param halt - Stop dispatching if a listener returns false
   * @returns Array of results from listeners
   */
  dispatch(event: string | Event, payload: any[] = [], halt: boolean = false): any[] {
    const [eventName, eventInstance] = this.parseEventAndPayload(event, payload);

    // Check if we should broadcast this event (for future broadcasting support)
    if (eventInstance) {
      this.shouldBroadcast(eventInstance, payload);
    }

    const listeners = this.getListeners(eventName);
    const responses: any[] = [];

    for (const listener of listeners) {
      const response = this.callListener(listener, eventInstance || eventName, payload);

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
   * @param event - Event name or instance
   * @param payload - Additional arguments to pass to listeners
   * @returns The first non-null response from a listener
   */
  until(event: string | Event, payload: any[] = []): any {
    const [eventName, eventInstance] = this.parseEventAndPayload(event, payload);
    const listeners = this.getListeners(eventName);

    for (const listener of listeners) {
      const response = this.callListener(listener, eventInstance || eventName, payload);

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
  flush(event: string): void {
    const queued = this.queuedEvents.get(event);

    if (!queued || queued.length === 0) {
      return;
    }

    // Dispatch each queued event
    for (const { payload } of queued) {
      this.dispatch(event, payload);
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
   * @returns Map of event names to their listeners
   */
  getRawListeners(): Map<string, EventListener[]> {
    return this.listeners;
  }

  /**
   * Get all listeners for an event (direct + wildcard matches)
   *
   * @param eventName - The event name
   * @returns Array of listeners
   */
  protected getListeners(eventName: string): EventListener[] {
    const directListeners = this.listeners.get(eventName) || [];
    const wildcardListeners = this.getWildcardListeners(eventName);

    return [...directListeners, ...wildcardListeners];
  }

  /**
   * Setup a wildcard listener
   *
   * @param event - Wildcard pattern (e.g., 'user.*')
   * @param listener - Listener to invoke
   */
  protected setupWildcardListen(event: string, listener: EventListener): void {
    if (!this.wildcards.has(event)) {
      this.wildcards.set(event, []);
    }

    this.wildcards.get(event)!.push(listener);
  }

  /**
   * Get all wildcard listeners matching an event name
   *
   * @param eventName - The event name to match
   * @returns Array of matching listeners
   */
  protected getWildcardListeners(eventName: string): EventListener[] {
    const matched: EventListener[] = [];

    for (const [pattern, listeners] of this.wildcards) {
      if (this.wildcardMatch(pattern, eventName)) {
        matched.push(...listeners);
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
   * Call a listener with the event and payload
   *
   * Handles different listener types (closure, class instance, string reference)
   *
   * @param listener - The listener to call
   * @param event - Event name or instance
   * @param payload - Additional payload arguments
   * @returns The result from the listener
   */
  protected callListener(listener: EventListener, event: string | Event, payload: any[]): any {
    try {
      const callable = this.makeListener(listener);
      return callable(event, ...payload);
    } catch (error) {
      // Re-throw the error to allow application-level error handling
      console.error(`Error calling event listener:`, error);
      throw error;
    }
  }

  /**
   * Create a callable function from a listener
   *
   * Resolves string listeners from container and wraps class instances
   *
   * @param listener - The listener to convert
   * @param wildcard - Whether this is for a wildcard listener
   * @returns Callable function
   */
  protected makeListener(listener: EventListener, wildcard: boolean = false): (...args: any[]) => any {
    // If it's a string, resolve from container
    if (typeof listener === 'string') {
      return this.createClassListener(listener, wildcard);
    }

    // If it's a function/class constructor
    if (typeof listener === 'function') {
      // Check if it's a class constructor (has prototype with handle method)
      if (listener.prototype && typeof listener.prototype.handle === 'function') {
        // It's a class constructor, instantiate and call handle
        return (event: Event, ...payload: any[]) => {
          const instance = new (listener as any)();
          return instance.handle(event);
        };
      }

      // It's a regular function (closure), return as-is
      return listener;
    }

    // If it's a class instance with handle method
    if (typeof listener === 'object' && 'handle' in listener) {
      const instance = listener as ListenerInterface;
      return (event: Event, ...payload: any[]) => {
        return instance.handle(event);
      };
    }

    throw new Error(`Invalid listener type: ${typeof listener}`);
  }

  /**
   * Create a listener from a class string reference
   *
   * Resolves the class from the container and calls its handle method
   *
   * @param listener - Class name/path to resolve
   * @param wildcard - Whether this is for a wildcard listener
   * @returns Callable function
   */
  protected createClassListener(listener: string, wildcard: boolean = false): (...args: any[]) => any {
    return (event: Event, ...payload: any[]) => {
      // Resolve the listener class from the container
      const instance = this.container.make<ListenerInterface>(listener);

      if (!instance || typeof instance.handle !== 'function') {
        throw new Error(`Listener [${listener}] does not have a handle method`);
      }

      // Call the handle method
      return instance.handle(event);
    };
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
}
