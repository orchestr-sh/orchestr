/**
 * Should Broadcast Contract
 *
 * Marks an event as broadcastable and describes how it reaches the wire.
 * Mirrors Illuminate\Contracts\Broadcasting\ShouldBroadcast / ShouldBroadcastNow
 * plus the broadcast customisation methods Laravel reads off a broadcast
 * event (`broadcastAs`, `broadcastWith`, `broadcastWhen`, `broadcastQueue`).
 *
 * TypeScript erases interfaces at compile time, so broadcasting is detected at
 * runtime: an event is broadcast when it answers `broadcastOn()` with a
 * non-empty set of channels and `shouldBroadcast()`/`broadcastWhen()` allow it.
 * `ShouldBroadcast` itself forces the "this event broadcasts" marker (a
 * `shouldBroadcast` boolean property, the runtime twin of `implements
 * ShouldBroadcast`), while `ShouldBroadcastNow` delivers synchronously instead
 * of through the queue.
 */

import type { ChannelLike } from '@/Broadcasting/Channels';

/**
 * An event that should be broadcast, queued for delivery by default (the
 * queue subsystem runs the actual driver call).
 *
 * The base `Event` class already answers `broadcastOn()` (empty by default),
 * so an event "is broadcastable" the moment it names at least one channel -
 * no separate runtime marker is needed, and `implements ShouldBroadcast`
 * documents the intent and type-checks the customisation methods below.
 */
export interface ShouldBroadcast {
  /**
   * The channel(s) this event broadcasts on.
   */
  broadcastOn(): ChannelLike | ChannelLike[];
  /**
   * The event name sent to clients; defaults to the class name.
   * Laravel: BroadcastEvent::broadcastAs()
   */
  broadcastAs?(): string;

  /**
   * The payload sent to clients; defaults to the event's public properties.
   * Laravel: BroadcastEvent::broadcastWith()
   */
  broadcastWith?(): Record<string, any>;

  /**
   * Conditionally broadcast: return false to skip this event entirely.
   * Laravel: BroadcastEvent::broadcastWhen()
   */
  broadcastWhen?(): boolean | Promise<boolean>;

  /**
   * The queue the broadcast job is pushed onto (null/undefined for the
   * default). Laravel: BroadcastEvent::broadcastQueue()
   */
  broadcastQueue?(): string | null;

  /**
   * The queue connection the broadcast job is pushed onto.
   * Laravel: the `connection` property of a queued broadcast.
   */
  broadcastConnection?(): string | null;

  /**
   * Defer the queued broadcast until the active database transaction commits.
   */
  afterCommit?: boolean;
}

/**
 * An event that broadcasts synchronously, bypassing the queue.
 * Laravel: Illuminate\Contracts\Broadcasting\ShouldBroadcastNow
 *
 * TypeScript erases the interface, so implementations declare the runtime
 * marker `readonly broadcastNow = true`.
 */
export interface ShouldBroadcastNow extends ShouldBroadcast {
  readonly broadcastNow?: true;
}

/**
 * Whether an event names channels to broadcast on.
 *
 * Recognises any object exposing a `broadcastOn()` method that returns at
 * least one channel (the structural twin of `implements ShouldBroadcast`), or
 * the explicit `broadcastNow` marker.
 */
export function isShouldBroadcast(event: any): event is ShouldBroadcast {
  if (event === null || typeof event !== 'object') {
    return false;
  }

  if (event.broadcastNow === true) {
    return true;
  }

  if (typeof event.broadcastOn !== 'function') {
    return false;
  }

  const channels = event.broadcastOn();

  return Array.isArray(channels) ? channels.length > 0 : !!channels;
}

/**
 * Whether a broadcastable event must be delivered now rather than queued.
 */
export function isShouldBroadcastNow(event: any): event is ShouldBroadcastNow {
  return event !== null && typeof event === 'object' && event.broadcastNow === true;
}
