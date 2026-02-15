import type { DispatcherContract } from './Contracts/Dispatcher';
import type { Event } from './Event';
import type { EventListener, EventSubscriber } from './types';

/**
 * Null Dispatcher
 *
 * A no-op event dispatcher implementation following the Null Object pattern.
 * Useful for testing or when you want to disable event dispatching entirely.
 *
 * All methods are implemented but do nothing, allowing code to call
 * dispatcher methods without side effects.
 *
 * @example
 * ```typescript
 * // Use in tests to disable events
 * const dispatcher = new NullDispatcher();
 * container.instance('events', dispatcher);
 *
 * // Events will be "dispatched" but nothing happens
 * dispatcher.dispatch(new UserRegistered(user));
 * // No listeners are called
 *
 * // Use for performance when events aren't needed
 * if (config.disableEvents) {
 *   app.singleton('events', () => new NullDispatcher());
 * }
 * ```
 */
export class NullDispatcher implements DispatcherContract {
  /**
   * Register an event listener (no-op)
   *
   * @param events - Event name(s) to listen for (ignored)
   * @param listener - Listener to invoke (ignored)
   */
  listen(events: string | string[], listener: EventListener): void {
    // No-op
  }

  /**
   * Check if an event has any listeners (always returns false)
   *
   * @param eventName - The event name to check (ignored)
   * @returns Always false
   */
  hasListeners(eventName: string): boolean {
    return false;
  }

  /**
   * Register an event subscriber (no-op)
   *
   * @param subscriber - The subscriber instance (ignored)
   */
  subscribe(subscriber: EventSubscriber): void {
    // No-op
  }

  /**
   * Dispatch an event to all listeners (no-op, returns empty array)
   *
   * @param event - Event name or instance (ignored)
   * @param payload - Additional arguments (ignored)
   * @param halt - Stop on false return (ignored)
   * @returns Empty array
   */
  dispatch(event: string | Event, payload: any[] = [], halt: boolean = false): any[] {
    return [];
  }

  /**
   * Dispatch an event until a listener returns a non-null response (always returns null)
   *
   * @param event - Event name or instance (ignored)
   * @param payload - Additional arguments (ignored)
   * @returns Always null
   */
  until(event: string | Event, payload: any[] = []): any {
    return null;
  }

  /**
   * Queue an event for later dispatch (no-op)
   *
   * @param event - Event name (ignored)
   * @param payload - Event payload (ignored)
   */
  push(event: string, payload: any[] = []): void {
    // No-op
  }

  /**
   * Flush all queued events (no-op)
   *
   * @param event - Event name to flush (ignored)
   */
  flush(event: string): void {
    // No-op
  }

  /**
   * Remove all listeners for an event (no-op)
   *
   * @param event - Event name (ignored)
   */
  forget(event: string): void {
    // No-op
  }

  /**
   * Clear all queued events (no-op)
   */
  forgetPushed(): void {
    // No-op
  }

  /**
   * Get raw listener mappings (always returns empty map)
   *
   * @returns Empty Map
   */
  getRawListeners(): Map<string, EventListener[]> {
    return new Map();
  }
}
