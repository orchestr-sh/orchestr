/**
 * PendingNotification - fluent on-delivery route builder
 *
 * Mirrors Illuminate\Notifications\PendingNotification: the object
 * returned by `Notification::route('mail', address)` collects inline
 * routes and hands the notification to the application's notification
 * router as an AnonymousNotifiable when `notify()`/`send()` is called.
 *
 * The router is resolved lazily (through a thunk) at delivery time, so
 * code that builds a pending notification before installing a fake still
 * records against the fake once it is swapped in.
 */

import type { NotificationRouterLike } from '@/Notifications/Contracts/NotificationRouter';
import { AnonymousNotifiable } from '@/Notifications/AnonymousNotifiable';

export class PendingNotification {
  protected routes: Record<string, any>;
  protected explicitChannels?: string[];

  /**
   * @param resolveRouter - Resolves the notification router at send time
   * @param routes - Initial channel routes, e.g. `{ mail: 'ada@example.com' }`
   */
  constructor(
    protected resolveRouter: () => NotificationRouterLike,
    routes: Record<string, any> = {}
  ) {
    this.routes = { ...routes };
  }

  /**
   * Add another channel route to the delivery.
   * Laravel: PendingNotification::route()
   */
  route(channel: string, route: any): this {
    this.routes[channel] = route;

    return this;
  }

  /**
   * Restrict delivery to the given channels.
   * Laravel: PendingNotification::via()
   */
  via(channels: string | string[]): this {
    this.explicitChannels = Array.isArray(channels) ? [...channels] : [channels];

    return this;
  }

  /**
   * The anonymous recipient the notification will be sent as.
   */
  notifiable(): AnonymousNotifiable {
    return new AnonymousNotifiable({ ...this.routes });
  }

  /**
   * Send the notification to the collected routes.
   * Laravel: PendingNotification::send($notification)
   */
  async send(notification: unknown): Promise<void> {
    await this.notify(notification);
  }

  /**
   * Alias of send(), matching the notifiable-side vocabulary.
   */
  async notify(notification: unknown): Promise<void> {
    const channels = this.explicitChannels ?? Object.keys(this.routes);

    await this.resolveRouter().send(this.notifiable(), notification, channels);
  }

  /**
   * Queue delivery of the notification.
   * Laravel: PendingNotification::queue()
   */
  async queue(notification: unknown): Promise<unknown> {
    const channels = this.explicitChannels ?? Object.keys(this.routes);

    return this.resolveRouter().queue(this.notifiable(), notification, channels);
  }
}
