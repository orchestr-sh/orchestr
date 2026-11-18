/**
 * Broadcast Event Normalisation
 *
 * The single, driver-agnostic path that turns a `ShouldBroadcast`-style event
 * into the {channels, event, payload} triple every broadcaster receives. All
 * drivers share it (DRY) and every `broadcastWith`/`broadcastAs`/`broadcastOn`
 * rule lives here, so a driver never re-derives an event's wire shape (OCP).
 *
 * Mirrors what Illuminate\Broadcasting\BroadcastEvent::handle() and
 * getPayloadFromEvent() do in Laravel, lifted out of the job so both the
 * synchronous dispatcher path and the queued BroadcastEvent job normalise
 * identically.
 */

import type { ChannelLike } from '@/Broadcasting/Channels';
import { toChannels } from '@/Broadcasting/Channels';

/**
 * The normalised broadcast: channels resolved to value objects, the client
 * event name, and the payload.
 */
export interface NormalizedBroadcast {
  channels: ReturnType<typeof toChannels>;
  event: string;
  payload: Record<string, any>;
}

/**
 * The event name clients listen for: `broadcastAs()` when defined, otherwise
 * the event's class name.
 * Laravel: BroadcastEvent::broadcastAs() ?? get_class($event)
 */
export function broadcastEventName(event: any): string {
  if (typeof event?.broadcastAs === 'function') {
    const name = event.broadcastAs();

    if (typeof name === 'string' && name !== '') {
      return name;
    }
  }

  return event?.constructor?.name ?? String(event);
}

/**
 * The broadcast payload: `broadcastWith()` when it returns an object,
 * otherwise the event's own enumerable data properties (skipping the
 * broadcast/queue plumbing).
 * Laravel: BroadcastEvent::getPayloadFromEvent()
 */
export function broadcastPayload(event: any): Record<string, any> {
  if (typeof event?.broadcastWith === 'function') {
    const payload = event.broadcastWith();

    if (payload !== null && payload !== undefined) {
      return payload;
    }
  }

  return event?.broadcastWith !== undefined && typeof event.broadcastWith !== 'function'
    ? { ...event.broadcastWith }
    : defaultPayload(event);
}

/**
 * Properties that are framework plumbing rather than broadcast data: the
 * Event base class's queue fields and the broadcast customisation markers.
 */
const EXCLUDED = new Set([
  'connection',
  'queue',
  'delay',
  'shouldBroadcast',
  'broadcastNow',
  'broadcastQueue',
  'afterCommit',
]);

/**
 * Fall back to the event's own enumerable properties, matching Laravel's
 * "public properties of the event" default payload.
 */
function defaultPayload(event: any): Record<string, any> {
  if (event === null || typeof event !== 'object') {
    return {};
  }

  const payload: Record<string, any> = {};

  for (const [key, value] of Object.entries(event)) {
    if (EXCLUDED.has(key) || typeof value === 'function') {
      continue;
    }

    payload[key] = serializeBroadcastValue(value);
  }

  return payload;
}

/**
 * Render a payload value for JSON transport: Date to ISO, objects exposing
 * toJSON() through it, everything else untouched (the drivers JSON-encode).
 */
function serializeBroadcastValue(value: any): any {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value !== null && typeof value === 'object' && typeof value.toJSON === 'function') {
    return value.toJSON();
  }

  return value;
}

/**
 * Resolve the channels an event broadcasts on.
 */
export function broadcastChannels(event: any): ChannelLike[] {
  const channels = typeof event?.broadcastOn === 'function' ? event.broadcastOn() : [];

  return Array.isArray(channels) ? channels : [channels];
}

/**
 * Normalise a broadcastable event into the driver-facing triple.
 */
export function normalizeBroadcastEvent(event: any): NormalizedBroadcast {
  return {
    channels: toChannels(broadcastChannels(event)),
    event: broadcastEventName(event),
    payload: broadcastPayload(event),
  };
}
