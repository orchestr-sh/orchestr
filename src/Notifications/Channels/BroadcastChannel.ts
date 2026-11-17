/**
 * BroadcastChannel - delivers notifications over broadcasting
 *
 * Mirrors Illuminate\Notifications\Channels\BroadcastChannel. Orchestr has
 * no broadcasting subsystem yet, so this channel delegates through the
 * container's `broadcast` binding when one is registered (OCP: the
 * notification layer never depends on a broadcasting implementation) and
 * fails with a clear, actionable message when nothing is there to
 * broadcast through.
 *
 * The event handed to the broadcaster carries the notification's
 * broadcast payload - `toBroadcast()` falling back to `toArray()` the way
 * Laravel wraps the notification in a BroadcastNotificationCreated event.
 */

import type { Channel } from '@/Notifications/Contracts/Channel';

/**
 * The minimal structural contract a broadcasting layer must satisfy to
 * receive notification broadcasts. A future BroadcastManager binding only
 * has to expose `broadcast(event, channels)` to plug in.
 */
export interface BroadcastDriverLike {
  broadcast(event: BroadcastNotificationLike, channels: unknown): Promise<unknown> | unknown;
}

/**
 * The broadcast representation handed to the broadcaster.
 */
export interface BroadcastNotificationLike {
  /** Class name of the notification being broadcast */
  type: string;

  /** The notification's broadcast payload */
  data: Record<string, any>;

  /** The notifiable's route values for the broadcast channel */
  channels: unknown;
}

export class BroadcastChannel implements Channel {
  constructor(protected broadcaster: () => BroadcastDriverLike | null) {}

  /**
   * Broadcast the notification to its channels.
   * Laravel: BroadcastChannel::send($notifiable, $notification)
   */
  async send(notifiable: any, notification: any): Promise<unknown> {
    const channels =
      notifiable && typeof notifiable.routeNotificationFor === 'function'
        ? notifiable.routeNotificationFor('broadcast', notification)
        : null;

    if (!channels || (Array.isArray(channels) && channels.length === 0)) {
      throw new Error(`No [broadcast] routes configured for [${nameOf(notifiable)}].`);
    }

    const broadcaster = this.broadcaster();

    if (!broadcaster) {
      throw new Error(
        'The broadcast channel requires the broadcasting subsystem. Register a broadcaster under the "broadcast" container binding first.'
      );
    }

    const event: BroadcastNotificationLike = {
      type: nameOf(notification),
      data: this.dataFor(notification, notifiable),
      channels,
    };

    return await broadcaster.broadcast(event, channels);
  }

  /**
   * The broadcast payload: toBroadcast() when it returns something,
   * toArray() otherwise.
   */
  protected dataFor(notification: any, notifiable: any): Record<string, any> {
    if (typeof notification?.toBroadcast === 'function') {
      const data = notification.toBroadcast(notifiable);

      if (data !== null && data !== undefined) {
        return data;
      }
    }

    if (typeof notification?.toArray === 'function') {
      return notification.toArray(notifiable) ?? {};
    }

    return {};
  }
}

/**
 * Human name for error messages: class name when available.
 */
function nameOf(value: any): string {
  return value?.constructor?.name ?? String(value);
}
