import type { DispatcherContract } from '@/Events/Contracts/Dispatcher';
import type { Container } from '@/Container/Container';
import type { Event } from '@/Events/Event';
import type { EventListener } from '@/Events/types';

/**
 * Dispatched Event Record
 *
 * Represents a single event dispatch with metadata
 */
interface DispatchedEvent {
  /** The event instance or event name */
  event: Event | string;

  /** Additional payload passed to the event */
  payload: any[];

  /** Timestamp when the event was dispatched */
  timestamp: number;
}

/**
 * Event Fake Dispatcher
 *
 * A test double for the event dispatcher that records all dispatched events
 * instead of actually calling listeners. Provides assertion methods to verify
 * event dispatching behavior in tests.
 *
 * @example
 * ```typescript
 * // Replace the real dispatcher with a fake
 * const fake = new EventFake(app);
 * app.instance('events', fake);
 *
 * // Test code that dispatches events
 * dispatch(new UserRegistered(user));
 *
 * // Assert the event was dispatched
 * fake.assertDispatched(UserRegistered);
 * fake.assertDispatchedTimes(UserRegistered, 1);
 * ```
 */
export class EventFake implements DispatcherContract {
  /**
   * All dispatched events organized by event name
   */
  protected dispatched: Map<string, DispatchedEvent[]> = new Map();

  /**
   * Events that should be faked (empty = fake all)
   */
  protected fakedEvents: string[] = [];

  /**
   * Events that should NOT be faked (all others will be)
   */
  protected exceptedEvents: string[] = [];

  /**
   * The original dispatcher (for pass-through)
   */
  protected originalDispatcher?: DispatcherContract;

  /**
   * Registered listeners (for assertListening)
   */
  protected listeners: Map<string, EventListener[]> = new Map();

  constructor(protected container: Container) {}

  /**
   * Set which events should be faked
   *
   * @param events - Array of event names or classes to fake
   */
  setFakedEvents(events: string[]): void {
    this.fakedEvents = events;
  }

  /**
   * Set which events should NOT be faked (all others will be)
   *
   * @param events - Array of event names or classes to NOT fake
   */
  setExceptedEvents(events: string[]): void {
    this.exceptedEvents = events;
  }

  /**
   * Set the original dispatcher for pass-through
   *
   * @param dispatcher - The real dispatcher instance
   */
  setOriginalDispatcher(dispatcher: DispatcherContract): void {
    this.originalDispatcher = dispatcher;
  }

  /**
   * Check if an event should be faked
   *
   * @param eventName - The event name to check
   * @returns true if the event should be faked
   */
  protected shouldFake(eventName: string): boolean {
    // If excepted events are set, fake everything except those
    if (this.exceptedEvents.length > 0) {
      return !this.exceptedEvents.includes(eventName);
    }

    // If faked events are set, only fake those
    if (this.fakedEvents.length > 0) {
      return this.fakedEvents.includes(eventName);
    }

    // Otherwise fake everything
    return true;
  }

  /**
   * Register an event listener
   *
   * @param events - Event name(s) to listen for
   * @param listener - The listener to call
   */
  listen(events: string | string[], listener: EventListener): void {
    // Store listeners for assertListening
    const eventArray = Array.isArray(events) ? events : [events];

    for (const event of eventArray) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }

      this.listeners.get(event)!.push(listener);
    }
  }

  /**
   * Check if an event has listeners
   *
   * @param eventName - The event name to check
   * @returns true if the event has registered listeners
   */
  hasListeners(eventName: string): boolean {
    return this.listeners.has(eventName) && this.listeners.get(eventName)!.length > 0;
  }

  /**
   * Register an event subscriber
   *
   * @param subscriber - The subscriber instance
   */
  subscribe(subscriber: any): void {
    // Faked dispatcher doesn't actually register subscribers
    // but stores them for assertListening
  }

  /**
   * Dispatch an event
   *
   * @param event - The event instance or name
   * @param payload - Additional arguments to pass
   * @param halt - Stop on first non-null response
   * @returns Array of listener results
   */
  dispatch(event: string | Event, payload: any[] = [], halt: boolean = false): any[] {
    const eventName = this.getEventName(event);

    if (!this.shouldFake(eventName)) {
      // Pass through to original dispatcher if it exists
      if (this.originalDispatcher) {
        return this.originalDispatcher.dispatch(event, payload, halt);
      }
      return [];
    }

    // Record the dispatch
    if (!this.dispatched.has(eventName)) {
      this.dispatched.set(eventName, []);
    }

    this.dispatched.get(eventName)!.push({
      event,
      payload,
      timestamp: Date.now(),
    });

    return [];
  }

  /**
   * Dispatch an event until the first non-null response
   *
   * @param event - The event instance or name
   * @param payload - Additional arguments to pass
   * @returns The first non-null listener result
   */
  until(event: string | Event, payload: any[] = []): any {
    return this.dispatch(event, payload, true)[0] || null;
  }

  /**
   * Push an event onto the queue for later flushing
   *
   * @param event - The event name
   * @param payload - Additional arguments to pass
   */
  push(event: string, payload: any[] = []): void {
    // Not implemented for faked dispatcher
  }

  /**
   * Flush all queued events
   *
   * @param event - The event name to flush
   */
  flush(event: string): void {
    // Not implemented for faked dispatcher
  }

  /**
   * Remove all listeners for an event
   *
   * @param event - The event name
   */
  forget(event: string): void {
    this.dispatched.delete(event);
    this.listeners.delete(event);
  }

  /**
   * Clear all queued events
   */
  forgetPushed(): void {
    // Not implemented for faked dispatcher
  }

  /**
   * Get all registered listeners
   *
   * @returns Map of event names to listeners
   */
  getRawListeners(): Map<string, EventListener[]> {
    return this.listeners;
  }

  /**
   * Get the event name from an event instance or string
   *
   * @param event - The event instance or name
   * @returns The event name
   */
  protected getEventName(event: string | Event): string {
    if (typeof event === 'string') {
      return event;
    }
    return event.constructor.name;
  }

  // ==================== Assertion Methods ====================

  /**
   * Assert that an event was dispatched
   *
   * @param event - The event name or class
   * @param callback - Optional callback to filter events
   * @throws Error if the event was not dispatched
   *
   * @example
   * ```typescript
   * // Assert event was dispatched
   * fake.assertDispatched(UserRegistered);
   *
   * // Assert event with specific properties
   * fake.assertDispatched(UserRegistered, (event) => {
   *   return event.user.email === 'test@example.com';
   * });
   * ```
   */
  assertDispatched(event: string | (new (...args: any[]) => Event), callback?: (event: Event) => boolean): void {
    const eventName = typeof event === 'string' ? event : event.name;
    const events = this.dispatched.get(eventName) || [];

    if (events.length === 0) {
      const dispatchedList = Array.from(this.dispatched.keys()).join(', ') || 'none';
      throw new Error(`Event [${eventName}] was not dispatched.\n` + `Dispatched events: ${dispatchedList}`);
    }

    if (callback) {
      const matching = events.filter((e) => {
        const eventObj = typeof e.event === 'string' ? null : e.event;
        return eventObj && callback(eventObj);
      });

      if (matching.length === 0) {
        throw new Error(
          `Event [${eventName}] was dispatched ${events.length} time(s) ` + `but none matched the provided callback.`
        );
      }
    }
  }

  /**
   * Assert that an event was NOT dispatched
   *
   * @param event - The event name or class
   * @param callback - Optional callback to filter events
   * @throws Error if the event was dispatched
   *
   * @example
   * ```typescript
   * // Assert event was not dispatched
   * fake.assertNotDispatched(UserDeleted);
   *
   * // Assert event with specific properties was not dispatched
   * fake.assertNotDispatched(UserRegistered, (event) => {
   *   return event.user.email === 'admin@example.com';
   * });
   * ```
   */
  assertNotDispatched(event: string | (new (...args: any[]) => Event), callback?: (event: Event) => boolean): void {
    const eventName = typeof event === 'string' ? event : event.name;
    const events = this.dispatched.get(eventName) || [];

    if (!callback) {
      if (events.length > 0) {
        throw new Error(`Event [${eventName}] was dispatched ${events.length} time(s).`);
      }
      return;
    }

    const matching = events.filter((e) => {
      const eventObj = typeof e.event === 'string' ? null : e.event;
      return eventObj && callback(eventObj);
    });

    if (matching.length > 0) {
      throw new Error(
        `Event [${eventName}] was unexpectedly dispatched ${matching.length} time(s) ` +
          `matching the provided callback.`
      );
    }
  }

  /**
   * Assert that an event was dispatched a specific number of times
   *
   * @param event - The event name or class
   * @param times - Expected number of dispatches
   * @throws Error if the dispatch count doesn't match
   *
   * @example
   * ```typescript
   * fake.assertDispatchedTimes(UserRegistered, 3);
   * ```
   */
  assertDispatchedTimes(event: string | (new (...args: any[]) => Event), times: number): void {
    const eventName = typeof event === 'string' ? event : event.name;
    const events = this.dispatched.get(eventName) || [];

    if (events.length !== times) {
      throw new Error(`Event [${eventName}] was dispatched ${events.length} time(s) instead of ${times}.`);
    }
  }

  /**
   * Assert that no events were dispatched
   *
   * @throws Error if any events were dispatched
   *
   * @example
   * ```typescript
   * fake.assertNothingDispatched();
   * ```
   */
  assertNothingDispatched(): void {
    const totalEvents = Array.from(this.dispatched.values()).reduce((sum, events) => sum + events.length, 0);

    if (totalEvents > 0) {
      const dispatched = Array.from(this.dispatched.entries())
        .map(([name, events]) => `  ${name}: ${events.length}`)
        .join('\n');

      throw new Error(`Expected no events to be dispatched, but ${totalEvents} were:\n${dispatched}`);
    }
  }

  /**
   * Assert that a listener is registered for an event
   *
   * @param event - The event name or class
   * @param listener - Optional specific listener to check for
   * @throws Error if the listener is not registered
   *
   * @example
   * ```typescript
   * // Assert any listener is registered
   * fake.assertListening(UserRegistered);
   *
   * // Assert specific listener is registered
   * fake.assertListening(UserRegistered, SendWelcomeEmail);
   * ```
   */
  assertListening(event: string | (new (...args: any[]) => Event), listener?: string | EventListener): void {
    const eventName = typeof event === 'string' ? event : event.name;
    const eventListeners = this.listeners.get(eventName) || [];

    if (eventListeners.length === 0) {
      throw new Error(`No listeners are registered for event [${eventName}].`);
    }

    if (listener) {
      const listenerName = typeof listener === 'string' ? listener : this.getListenerName(listener);
      const hasListener = eventListeners.some((l) => {
        const lName = typeof l === 'string' ? l : this.getListenerName(l);
        return lName === listenerName;
      });

      if (!hasListener) {
        throw new Error(`Listener [${listenerName}] is not registered for event [${eventName}].`);
      }
    }
  }

  /**
   * Get the name of a listener
   *
   * @param listener - The listener instance or closure
   * @returns The listener name
   */
  protected getListenerName(listener: EventListener): string {
    if (typeof listener === 'string') {
      return listener;
    }

    if (typeof listener === 'function') {
      return listener.name || '<Closure>';
    }

    if (typeof listener === 'object' && listener.constructor) {
      return listener.constructor.name;
    }

    return '<Unknown>';
  }

  // ==================== Helper Methods ====================

  /**
   * Get all dispatched events for a given event name
   *
   * @param event - The event name or class
   * @returns Array of dispatched event records
   *
   * @example
   * ```typescript
   * const dispatches = fake.getDispatched(UserRegistered);
   * expect(dispatches).toHaveLength(3);
   * ```
   */
  getDispatched(event: string | (new (...args: any[]) => Event)): DispatchedEvent[] {
    const eventName = typeof event === 'string' ? event : event.name;
    return this.dispatched.get(eventName) || [];
  }

  /**
   * Get all dispatched event names
   *
   * @returns Array of event names
   */
  getDispatchedEventNames(): string[] {
    return Array.from(this.dispatched.keys());
  }

  /**
   * Get the total count of dispatched events
   *
   * @returns Total number of event dispatches
   */
  getDispatchedCount(): number {
    return Array.from(this.dispatched.values()).reduce((sum, events) => sum + events.length, 0);
  }

  /**
   * Clear all recorded dispatches
   *
   * @example
   * ```typescript
   * // Clear between tests
   * fake.clear();
   * ```
   */
  clear(): void {
    this.dispatched.clear();
  }

  /**
   * Clear all registered listeners
   */
  clearListeners(): void {
    this.listeners.clear();
  }

  /**
   * Reset the fake completely
   */
  reset(): void {
    this.clear();
    this.clearListeners();
    this.fakedEvents = [];
    this.exceptedEvents = [];
    this.originalDispatcher = undefined;
  }
}
