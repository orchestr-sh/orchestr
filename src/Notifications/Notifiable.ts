/**
 * Notifiable - the notification concern for models (and anything else
 * that wants to receive notifications)
 *
 * The port of Laravel's `Illuminate\Notifications\RoutesNotifications`
 * trait: gives an Ensemble model `notify`/`notifyNow` (delivery through
 * the application's notification router), `routeNotificationFor` (the
 * channel-routing convention: a `routeNotificationForMail()` method or
 * property first, then the built-in defaults), and `notifications()` -
 * the polymorphic relation over stored DatabaseNotification rows.
 *
 * @example
 * ```typescript
 * class User extends Notifiable(Ensemble) {
 *   static fillable = ['name', 'email'];
 *
 *   getTable(): string {
 *     return 'users';
 *   }
 *
 *   routeNotificationForMail(): string {
 *     return this.getAttribute('email');
 *   }
 * }
 *
 * await new User({ name: 'Ada', email: 'ada@example.com' }).notify(new InvoicePaid(invoice));
 * ```
 */

import type { Ensemble } from '@/Database/Ensemble/Ensemble';
import type { NotificationRouterLike } from '@/Notifications/Contracts/NotificationRouter';
import { DatabaseNotification } from '@/Notifications/DatabaseNotification';
import { getGlobalApp } from '@/Support/helpers';

/**
 * Constructor type accepting both concrete and abstract classes so the
 * concern can wrap Ensemble itself (same shape as Auth's concerns).
 */
export type NotifiableConstructor<T extends Ensemble = Ensemble> = abstract new (...args: any[]) => T;

/**
 * The instance surface the concern adds
 */
export interface NotifiableContract {
  /**
   * Send a notification - or a list of them - through the application's
   * notification router. Queueable notifications go through the queue.
   */
  notify(notification: unknown | unknown[], channels?: string | string[]): Promise<void>;

  /**
   * Send a notification synchronously, queue markers notwithstanding.
   */
  notifyNow(notification: unknown | unknown[], channels?: string | string[]): Promise<void>;

  /**
   * Where the given channel should deliver to for this notifiable.
   */
  routeNotificationFor(channel: string, notification?: unknown): unknown;

  /**
   * The stored (database-channel) notifications for this notifiable.
   */
  notifications(): unknown;
}

/**
 * Resolve the notification router from the running application.
 *
 * Reads the `notifications` container binding on every call so the
 * NotificationSender installed by the provider and the NotificationFake
 * swapped in by `Notification.fake()` behave identically (DRY).
 */
export function resolveNotificationRouter(): NotificationRouterLike {
  const app = getGlobalApp();

  if (!app || !app.bound('notifications')) {
    throw new Error('Notifications are not available. Register the NotificationServiceProvider first.');
  }

  return app.make<NotificationRouterLike>('notifications');
}

/**
 * The interface flavour of the trait: plain objects (or hand-rolled
 * notifiables) can declare it without the mixin.
 */
export interface Notifiable extends NotifiableContract {}

/**
 * The instance type the mixin produces - an Ensemble that also answers
 * the notification questions (same shape as Auth's HasAuthenticatable).
 */
export type NotifiableInstance = Ensemble & NotifiableContract;

export function Notifiable<T extends NotifiableConstructor>(Base: T): T & NotifiableConstructor<NotifiableInstance> {
  abstract class NotifiableMixin extends Base implements NotifiableContract {
    /**
     * Deliver a notification (or several) to this notifiable.
     * Laravel: RoutesNotifications::notify()
     */
    async notify(notification: unknown | unknown[], channels?: string | string[]): Promise<void> {
      const router = resolveNotificationRouter();

      for (const each of wrap(notification)) {
        await router.send(this, each, channels);
      }
    }

    /**
     * Deliver synchronously, even when the notification is queueable.
     * Laravel: RoutesNotifications::notifyNow()
     */
    async notifyNow(notification: unknown | unknown[], channels?: string | string[]): Promise<void> {
      const router = resolveNotificationRouter();

      for (const each of wrap(notification)) {
        await router.sendNow(this, each, channels);
      }
    }

    /**
     * The route for a channel: the `routeNotificationFor{Studly()}`
     * method, then a property of that name, then the built-in defaults
     * (the `notifications()` relation for database, the `email`
     * attribute for mail).
     * Laravel: RoutesNotifications::routeNotificationFor()
     */
    routeNotificationFor(channel: string, notification?: unknown): unknown {
      const method = `routeNotificationFor${studly(channel)}`;

      const self = this as any;

      if (typeof self[method] === 'function') {
        return self[method](notification);
      }

      if (self[method] !== undefined) {
        return self[method];
      }

      if (channel === 'database') {
        return typeof self.notifications === 'function' ? self.notifications() : null;
      }

      if (channel === 'mail') {
        const email = typeof self.getAttribute === 'function' ? self.getAttribute('email') : self.email;

        return email ?? null;
      }

      return null;
    }

    /**
     * The stored notifications for this notifiable.
     * Laravel: Notifiable::notifications()
     */
    notifications(): unknown {
      // morphMany is protected on Ensemble; this concern is mixed into an
      // Ensemble subclass, so the runtime `this` always carries it.
      return (this as any).morphMany(DatabaseNotification, 'notifiable');
    }
  }

  return NotifiableMixin as unknown as T & NotifiableConstructor<NotifiableInstance>;
}

/**
 * One item or many, as an array. Laravel: Arr::wrap().
 */
function wrap(value: unknown | unknown[]): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * Minimal studly-case helper for building the routing method name.
 */
function studly(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}
