/**
 * Notification Facade
 *
 * Static access to the notification router: deliver through the notifiable
 * and notification channels, address recipients on demand, swap in custom
 * channels, or fake the whole subsystem for tests.
 *
 * @example
 * ```typescript
 * import { Notification } from '@orchestr-sh/orchestr/Facades';
 *
 * await Notification.send(user, new InvoicePaid(invoice));       // via() channels, queue-aware
 * await Notification.sendNow(user, new InvoicePaid(invoice));    // always synchronous
 * await Notification.route('mail', 'guest@example.com').notify(new InvoicePaid(invoice));
 *
 * const notifications = Notification.fake();
 * await Notification.send(user, new InvoicePaid(invoice));
 * notifications.assertSentTo(user, InvoicePaid);
 * notifications.assertCount(1);
 * ```
 */

import type { NotificationSender } from '@/Notifications/NotificationSender';
import type { NotificationFake } from '@/Support/Testing/Fakes/NotificationFake';
import { PendingNotification } from '@/Notifications/PendingNotification';
import { Facade } from '@/Support/Facade';
import { Notification as NotificationInstaller } from '@/Testing/Fakes';

class NotificationFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'notifications';
  }

  /**
   * Fake notifications for testing
   *
   * Replaces the `notifications` container binding with a NotificationFake
   * that records every send instead of running channels, and provides
   * Laravel-style assertions (assertSent, assertSentTo, assertSentOnDemand,
   * assertCount, assertNothingSent, ...). Delegates to the shared Testing
   * installer so `this.fakeNotifications()` in test cases and this facade
   * always agree on the active fake (DRY).
   *
   * @returns NotificationFake instance for making assertions
   */
  static fake(): NotificationFake {
    const app = this.getFacadeApplication();

    if (!app) {
      throw new Error('Application not initialized. Cannot fake notifications.');
    }

    const fake = NotificationInstaller.fake(app);

    // Drop any cached facade root so subsequent Notification.* calls resolve the fake.
    this.clearResolvedInstance(this.getFacadeAccessor());

    return fake;
  }

  /**
   * The active notification fake, when notifications are being faked
   * through the Testing installer; null otherwise.
   * Laravel: Notification::getFacadeRoot() being a NotificationFake
   */
  static fakeInstance(): NotificationFake | null {
    return NotificationInstaller.instance();
  }

  /**
   * Start an on-demand notification addressed to a channel route. The
   * router is resolved when the notification is actually delivered, so
   * installing a fake after this call still records the send.
   * Laravel: Notification::route($channel, $route)
   */
  static route(channel: string, route: any): PendingNotification {
    return new PendingNotification(() => this.getFacadeRoot(), { [channel]: route });
  }
}

export const Notification = new Proxy(NotificationFacadeClass, {
  get(target, prop) {
    // First check if it's a static method on the facade class itself
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    // Then try to get from the facade root (the NotificationSender - or
    // the NotificationFake once the notifications binding has been swapped)
    try {
      const root = (target as any).getFacadeRoot() as NotificationSender & NotificationFake;
      if (root && prop in root) {
        const value = (root as any)[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(root, args);
        }
        return value;
      }
    } catch (error) {
      // Facade root not available yet
    }

    return undefined;
  },
}) as unknown as typeof NotificationFacadeClass & NotificationSender & NotificationFake;
