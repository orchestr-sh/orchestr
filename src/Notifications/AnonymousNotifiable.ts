/**
 * AnonymousNotifiable - a recipient without a model
 *
 * Mirrors Illuminate\Notifications\AnonymousNotifiable: the stand-in used
 * for on-demand notifications, where the routes are declared inline
 * instead of read from a persisted notifiable. It answers the same
 * `routeNotificationFor` question channels ask models, so the channel
 * implementations never need to know which kind of recipient they have.
 *
 * @example
 * ```typescript
 * const notifiable = new AnonymousNotifiable({ mail: 'guest@example.com' });
 *
 * await sender.send(notifiable, new InvoicePaid(invoice), ['mail']);
 * ```
 */

import { resolveNotificationRouter } from '@/Notifications/Notifiable';

export class AnonymousNotifiable {
  constructor(public routes: Record<string, any> = {}) {}

  /**
   * Add (or replace) the route for a channel.
   * Laravel: AnonymousNotifiable::route()
   */
  route(channel: string, route: any): this {
    this.routes[channel] = route;

    return this;
  }

  /**
   * The route registered for the given channel, or null when the
   * notification is not addressed there.
   * Laravel: AnonymousNotifiable::routeNotificationFor()
   */
  routeNotificationFor(channel: string, _notification?: any): any {
    const route = this.routes[channel];

    return route === undefined ? null : route;
  }

  /**
   * Send a notification to this anonymous recipient through the
   * application's notification router (the container's `notifications`
   * binding - the real sender, or its fake).
   * Laravel: RoutesNotifications::notify()
   */
  async notify(notification: any, channels?: string | string[]): Promise<void> {
    await resolveNotificationRouter().send(this, notification, channels ?? Object.keys(this.routes));
  }
}
