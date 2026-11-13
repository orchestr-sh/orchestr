import type { Event } from '@/Events/Event';
import type { EventListener, EventNameOrClass, EventSubscriber } from '@/Events/types';

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
 * await dispatcher.dispatch(new UserRegistered(user));
 * ```
 */
export interface DispatcherContract {
  /**
   * Register an event listener
   *
   * @param events - Event name(s) or class(es) to listen for
   * @param listener - Listener to invoke when event is dispatched
   * @param queued - Force the listener through the queue instead of running it inline
   *
   * @example
   * ```typescript
   * // Single event
   * dispatcher.listen('user.registered', SendWelcomeEmail);
   *
   * // Event class reference
   * dispatcher.listen(UserRegistered, SendWelcomeEmail);
   *
   * // Multiple events
   * dispatcher.listen(['user.registered', 'user.updated'], LogUserActivity);
   *
   * // Wildcard
   * dispatcher.listen('user.*', LogAllUserEvents);
   *
   * // Queued listener
   * dispatcher.listen('user.registered', SendWelcomeEmail, true);
   * ```
   */
  listen(events: EventNameOrClass | EventNameOrClass[], listener: EventListener, queued?: boolean): void;

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
   * Listeners are awaited one at a time in registration order (direct
   * listeners first, then wildcard listeners), so async listeners complete
   * before the returned promise resolves.
   *
   * @param event - Event name or instance
   * @param payload - Additional arguments to pass to listeners
   * @param halt - Stop dispatching if a listener returns false
   * @returns Promise resolving to the array of results from listeners
   *
   * @example
   * ```typescript
   * // Dispatch with event instance
   * await dispatcher.dispatch(new UserRegistered(user));
   *
   * // Dispatch with event name and payload
   * await dispatcher.dispatch('user.registered', [user]);
   *
   * // Halt on first false return
   * await dispatcher.dispatch(new OrderProcessing(order), [], true);
   * ```
   */
  dispatch(event: string | Event, payload?: any[], halt?: boolean): Promise<any[]>;

  /**
   * Dispatch an event until a listener returns a non-null response
   *
   * Each listener is awaited in turn and the first non-null response - which
   * includes `false`, the model-event halt signal - stops the loop.
   *
   * @param event - Event name or instance
   * @param payload - Additional arguments to pass to listeners
   * @returns Promise resolving to the first non-null response from a listener
   *
   * @example
   * ```typescript
   * // Get the first validation result
   * const isValid = await dispatcher.until(new ValidateOrder(order));
   * ```
   */
  until(event: string | Event, payload?: any[]): Promise<any>;

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
   * await dispatcher.flush('send.notification');
   * ```
   */
  push(event: string, payload?: any[]): void;

  /**
   * Flush (dispatch) all queued events for a specific event name
   *
   * @param event - Event name to flush
   */
  flush(event: string): Promise<void>;

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
