import type { Event } from '@/Events/Event';
import type { EventListener, EventSubscriber } from '@/Events/types';

/**
 * Event Dispatcher Contract
 *
 * Defines the interface for the event dispatcher service.
 * The dispatcher manages event listeners and dispatches events to them.
 *
 * @example
 * ```typescript
 * const dispatcher = app.make<DispatcherContract>('events');
 *
 * // Register a listener
 * dispatcher.listen(UserRegistered, SendWelcomeEmail);
 *
 * // Dispatch an event
 * dispatcher.dispatch(new UserRegistered(user));
 * ```
 */
export interface DispatcherContract {
  /**
   * Register an event listener
   *
   * @param events - Event name(s) to listen for
   * @param listener - Listener to invoke when event is dispatched
   *
   * @example
   * ```typescript
   * // Single event
   * dispatcher.listen('user.registered', SendWelcomeEmail);
   *
   * // Multiple events
   * dispatcher.listen(['user.registered', 'user.updated'], LogUserActivity);
   *
   * // Wildcard
   * dispatcher.listen('user.*', LogAllUserEvents);
   * ```
   */
  listen(events: string | string[], listener: EventListener): void;

  /**
   * Check if an event has any listeners
   *
   * @param eventName - The event name to check
   * @returns True if the event has listeners
   */
  hasListeners(eventName: string): boolean;

  /**
   * Register an event subscriber
   *
   * Subscribers can register multiple event listeners at once
   *
   * @param subscriber - The subscriber instance
   *
   * @example
   * ```typescript
   * class UserEventSubscriber implements EventSubscriber {
   *   subscribe(events: DispatcherContract) {
   *     events.listen('user.registered', this.onRegistered.bind(this));
   *     events.listen('user.updated', this.onUpdated.bind(this));
   *   }
   *
   *   onRegistered(event: UserRegistered) { }
   *   onUpdated(event: UserUpdated) { }
   * }
   *
   * dispatcher.subscribe(new UserEventSubscriber());
   * ```
   */
  subscribe(subscriber: EventSubscriber): void;

  /**
   * Dispatch an event to all listeners
   *
   * @param event - Event name or instance
   * @param payload - Additional arguments to pass to listeners
   * @param halt - Stop dispatching if a listener returns false
   * @returns Array of results from listeners
   *
   * @example
   * ```typescript
   * // Dispatch with event instance
   * dispatcher.dispatch(new UserRegistered(user));
   *
   * // Dispatch with event name and payload
   * dispatcher.dispatch('user.registered', [user]);
   *
   * // Halt on first false return
   * dispatcher.dispatch(new OrderProcessing(order), [], true);
   * ```
   */
  dispatch(event: string | Event, payload?: any[], halt?: boolean): any[];

  /**
   * Dispatch an event until a listener returns a non-null response
   *
   * This is useful for events where you want the first "truthy" response
   *
   * @param event - Event name or instance
   * @param payload - Additional arguments to pass to listeners
   * @returns The first non-null response from a listener
   *
   * @example
   * ```typescript
   * // Get the first validation result
   * const isValid = dispatcher.until(new ValidateOrder(order));
   * ```
   */
  until(event: string | Event, payload?: any[]): any;

  /**
   * Queue an event for later dispatch
   *
   * @param event - Event name
   * @param payload - Event payload
   *
   * @example
   * ```typescript
   * dispatcher.push('send.notification', [user, message]);
   * // Later...
   * dispatcher.flush('send.notification');
   * ```
   */
  push(event: string, payload?: any[]): void;

  /**
   * Flush (dispatch) all queued events for a specific event name
   *
   * @param event - Event name to flush
   */
  flush(event: string): void;

  /**
   * Remove all listeners for an event
   *
   * @param event - Event name
   */
  forget(event: string): void;

  /**
   * Clear all queued events
   */
  forgetPushed(): void;

  /**
   * Get raw listener mappings
   *
   * @returns Map of event names to their listeners
   */
  getRawListeners(): Map<string, EventListener[]>;
}
