/**
 * Cache Event Dispatcher Contract
 *
 * The minimal slice of the event dispatcher the cache subsystem depends
 * on. Declaring it structurally keeps the Cache subsystem free of a
 * runtime dependency on the Events subsystem while still accepting the
 * real Dispatcher or any test double.
 *
 * Mirrors the `events` dependency of Laravel's cache stores.
 */

import type { Event } from '@/Events/Event';

export interface CacheEventDispatcher {
  /**
   * Dispatch an event to all registered listeners
   */
  dispatch(event: Event | string, payload?: any[], halt?: boolean): Promise<unknown>;
}
