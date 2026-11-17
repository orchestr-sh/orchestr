/**
 * DatabaseChannel - stores notifications in the database
 *
 * Mirrors Illuminate\Notifications\Channels\DatabaseChannel. The payload
 * comes from the notification's `toDatabase()` (falling back to `toArray()`
 * the Laravel way), and the row is written through the notifiable's
 * `notifications()` morph relation so the `notifiable_type` /
 * `notifiable_id` columns line up with however the application maps morph
 * classes (DRY: the relation owns the keys, the channel does not guess).
 */

import type { Channel } from '@/Notifications/Contracts/Channel';

export class DatabaseChannel implements Channel {
  /**
   * Persist the notification and return the stored row.
   * Laravel: DatabaseChannel::send($notifiable, $notification)
   */
  async send(notifiable: any, notification: any): Promise<unknown> {
    const relation = this.relationFor(notifiable, notification);

    if (!relation || typeof relation.create !== 'function') {
      throw new Error(`No [database] routes configured for [${nameOf(notifiable)}].`);
    }

    return relation.create({
      type: nameOf(notification),
      data: this.dataFor(notification, notifiable),
      read_at: null,
    });
  }

  /**
   * The notification payload: toDatabase() when it returns something,
   * toArray() otherwise. Laravel resolves the same fallback chain.
   */
  protected dataFor(notification: any, notifiable: any): Record<string, any> {
    if (typeof notification?.toDatabase === 'function') {
      const data = notification.toDatabase(notifiable);

      if (data !== null && data !== undefined) {
        return data;
      }
    }

    if (typeof notification?.toArray === 'function') {
      return notification.toArray(notifiable) ?? {};
    }

    return {};
  }

  /**
   * The morph relation the row is written through. The notifiable's
   * `database` route is used when it already looks like a relation (Laravel's
   * `routeNotificationFor('database')` returns exactly this), when it is a
   * model carrying its own notifications() we route through that model, and
   * otherwise the notifiable's own notifications() is consulted.
   */
  protected relationFor(notifiable: any, notification: any): any {
    const route =
      notifiable && typeof notifiable.routeNotificationFor === 'function'
        ? notifiable.routeNotificationFor('database', notification)
        : null;

    if (route && typeof route.create === 'function') {
      return route;
    }

    if (route && typeof route.notifications === 'function') {
      return route.notifications();
    }

    if (notifiable && typeof notifiable.notifications === 'function') {
      return notifiable.notifications();
    }

    return null;
  }
}

/**
 * Human name for error messages: class name when available.
 */
function nameOf(value: any): string {
  return value?.constructor?.name ?? String(value);
}
