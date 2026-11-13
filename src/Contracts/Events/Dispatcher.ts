/**
 * Dispatcher Contract
 *
 * Defines the interface for the event dispatcher
 * This is the minimum contract needed for Task 3 implementation
 */

import type { Event } from '@/Events/Event';

/**
 * Event listener type
 * Can be a class instance, closure, or string reference
 */
export type EventListener<TEvent extends Event = Event> =
  | { handle(event: TEvent): void | false | Promise<void | false> }
  // widened parameter: concrete-event closures stay assignable (contravariance)
  | ((event: any) => void | false | Promise<void | false>)
  | string;

/**
 * Event subscriber interface
 */
export interface EventSubscriber {
  subscribe(events: DispatcherContract): void | Record<string, string | string[]>;
}

/**
 * Dispatcher Contract Interface
 *
 * Provides event dispatching, listener registration, and queue management
 */
export interface DispatcherContract {
  /**
   * Register an event listener with the dispatcher
   *
   * @param events - Event name(s) or class(es) to listen for
   * @param listener - Listener callback or class
   * @param queued - Force the listener through the queue instead of running it inline
   */
  listen(
    events: string | (new (...args: any[]) => Event) | Array<string | (new (...args: any[]) => Event)>,
    listener: EventListener,
    queued?: boolean
  ): void;

  /**
   * Determine if a given event has listeners
   *
   * @param eventName - Name of the event
   * @returns True if listeners exist
   */
  hasListeners(eventName: string): boolean;

  /**
   * Register an event subscriber with the dispatcher
   *
   * @param subscriber - Event subscriber instance
   */
  subscribe(subscriber: EventSubscriber): void;

  /**
   * Dispatch an event and call the listeners
   *
   * Listeners are awaited in registration order, direct listeners before
   * wildcard listeners.
   *
   * @param event - Event name or instance
   * @param payload - Additional data to pass to listeners
   * @param halt - Stop on first false response
   * @returns Promise resolving to the array of listener responses
   */
  dispatch(event: string | Event, payload?: any[], halt?: boolean): Promise<any[]>;

  /**
   * Dispatch an event until the first non-null response
   *
   * @param event - Event name or instance
   * @param payload - Additional data to pass to listeners
   * @returns Promise resolving to the first non-null response
   */
  until(event: string | Event, payload?: any[]): Promise<any>;

  /**
   * Push an event onto the queue for later dispatch
   *
   * @param event - Event name
   * @param payload - Event data
   */
  push(event: string, payload?: any[]): void;

  /**
   * Flush a set of pushed events
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
   * Forget all pushed events
   */
  forgetPushed(): void;

  /**
   * Get the raw listeners registered with the dispatcher
   *
   * @returns Map of event names to listeners
   */
  getRawListeners(): Map<string, EventListener[]>;
}
