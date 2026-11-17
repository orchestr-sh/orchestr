/**
 * NotificationFake
 *
 * Test double for the notification broker: records every notification the
 * application sends and answers Laravel-style assertions about who
 * received what. Bound under the `notifications` container key so a future
 * notification subsystem can be swapped wholesale.
 *
 * Mirrors Illuminate\Support\Testing\Fakes\NotificationFake.
 *
 * @example
 * ```typescript
 * const notifications = new NotificationFake();
 *
 * await notifications.send(user, new OrderShipped(order), ['mail']);
 *
 * notifications.assertSentTo(user, OrderShipped);
 * notifications.assertNotSent(OrderShipped, (n) => n.orderId !== 2);
 * ```
 */

import type { MailableMatcher } from '@/Support/Testing/Fakes/MailFake';

/**
 * One recorded send
 */
export interface SentNotification {
  /** The user(s) notified */
  notifiables: any[];

  /** The notification instance */
  notification: any;

  /** Channels the notification went out on, when provided */
  channels: string[];
}

export class NotificationFake {
  /**
   * Every notification sent through this fake, in order
   */
  public readonly sentNotifications: SentNotification[] = [];

  /**
   * Send a notification to one or many notifiables
   * Laravel: Notification::send()
   */
  async send(notifiables: unknown, notification: unknown, channels?: string[]): Promise<void> {
    this.sentNotifications.push({
      notifiables: Array.isArray(notifiables) ? [...notifiables] : [notifiables],
      notification,
      channels: channels ?? inferChannels(notification, Array.isArray(notifiables) ? notifiables[0] : notifiables),
    });
  }

  /**
   * Fluent `Notification::facade()->send($notifiable, $notification)` form
   * Laravel: Notification::send() via the anonymous notifiable path
   */
  route(route: Record<string, any>, notification: any): void {
    this.sentNotifications.push({
      notifiables: [route],
      notification,
      channels: Object.keys(route),
    });
  }

  // ==================== Assertions ====================

  /**
   * Assert the notifiable received the notification
   * Laravel: Notification::assertSentTo()
   */
  assertSentTo(notifiable: any, matcher: MailableMatcher, callback?: (notification: any) => boolean): void {
    const matching = this.sentNotifications.filter(
      (record) => record.notifiables.includes(notifiable) && notificationMatches(record.notification, matcher)
    );

    if (matching.length === 0) {
      throw new Error(
        `A notification [${nameOf(matcher)}] was not sent to [${notifiableName(notifiable)}].\n` +
          `Sent: ${this.describe()}`
      );
    }

    if (callback && !matching.some((record) => callback(record.notification))) {
      throw new Error(
        `Notification [${nameOf(matcher)}] was sent to [${notifiableName(notifiable)}] ` +
          'but none matched the provided callback.'
      );
    }
  }

  /**
   * Assert the notifiable did not receive the notification
   * Laravel: Notification::assertNotSentTo()
   */
  assertNotSentTo(notifiable: any, matcher: MailableMatcher, callback?: (notification: any) => boolean): void {
    const matching = this.sentNotifications.filter(
      (record) => record.notifiables.includes(notifiable) && notificationMatches(record.notification, matcher)
    );

    if (matching.length === 0) {
      return;
    }

    if (!callback) {
      throw new Error(
        `The notification [${nameOf(matcher)}] was unexpectedly sent to [${notifiableName(notifiable)}].`
      );
    }

    if (matching.some((record) => callback(record.notification))) {
      throw new Error(
        `The notification [${nameOf(matcher)}] was sent to [${notifiableName(notifiable)}] ` +
          'matching the provided callback.'
      );
    }
  }

  /**
   * Assert a matching notification was sent to anyone
   * Laravel: Notification::assertSent()
   */
  assertSent(matcher: MailableMatcher, callback?: (notification: any, notifiable: any) => boolean): void {
    const matching = this.sentNotifications.filter((record) => notificationMatches(record.notification, matcher));

    if (matching.length === 0) {
      throw new Error(`No notification [${nameOf(matcher)}] was sent.\nSent: ${this.describe()}`);
    }

    if (callback && !matching.some((record) => record.notifiables.some((who) => callback(record.notification, who)))) {
      throw new Error(
        `Notification [${nameOf(matcher)}] was sent ${matching.length} time(s) but none matched the provided callback.`
      );
    }
  }

  /**
   * Assert no matching notification was sent
   * Laravel: Notification::assertNotSent()
   */
  assertNotSent(matcher: MailableMatcher, callback?: (notification: any) => boolean): void {
    const matching = this.sentNotifications.filter((record) => notificationMatches(record.notification, matcher));

    if (matching.length === 0) {
      return;
    }

    if (!callback) {
      throw new Error(`The notification [${nameOf(matcher)}] was unexpectedly sent ${matching.length} time(s).`);
    }

    if (matching.some((record) => callback(record.notification))) {
      throw new Error(`The notification [${nameOf(matcher)}] was sent matching the provided callback.`);
    }
  }

  /**
   * Assert a notification was sent exactly this many times
   * Laravel: Notification::assertSentTimes()
   */
  assertSentTimes(matcher: MailableMatcher, times: number): void {
    const count = this.sentNotifications.filter((record) => notificationMatches(record.notification, matcher)).length;

    if (count !== times) {
      throw new Error(`Expected [${nameOf(matcher)}] to be sent ${times} time(s), but it was sent ${count} time(s).`);
    }
  }

  /**
   * Assert nothing was sent at all
   * Laravel: Notification::assertNothingSent()
   */
  assertNothingSent(): void {
    if (this.sentNotifications.length > 0) {
      throw new Error(
        `Expected no notifications to be sent, but ${this.sentNotifications.length} were.\nSent: ${this.describe()}`
      );
    }
  }

  /**
   * The number of notifications sent
   * Laravel: Notification::sentNotifications()->count()
   */
  size(): number {
    return this.sentNotifications.length;
  }

  /**
   * Forget every recorded notification
   */
  reset(): void {
    this.sentNotifications.length = 0;
  }

  protected describe(): string {
    if (this.sentNotifications.length === 0) {
      return 'none';
    }

    return this.sentNotifications
      .map((record) => `${nameOf(record.notification)} -> ${record.notifiables.map(notifiableName).join(', ')}`)
      .join('; ');
  }
}

/**
 * Whether a recorded notification matches a name/class/instance/predicate
 */
function notificationMatches(notification: any, matcher: MailableMatcher): boolean {
  if (typeof matcher === 'function' && matcher.prototype === undefined) {
    return (matcher as (value: any) => boolean)(notification);
  }

  if (typeof matcher === 'string') {
    return notification?.constructor?.name === matcher;
  }

  if (typeof matcher === 'function') {
    return notification instanceof matcher;
  }

  return notification === matcher || notification?.constructor?.name === matcher?.constructor?.name;
}

/**
 * Ask the notification which channels it wants, when it exposes via()
 */
function inferChannels(notification: any, notifiable: any): string[] {
  if (notification && typeof notification.via === 'function') {
    const channels = notification.via(notifiable);

    if (Array.isArray(channels)) {
      return channels.map(String);
    }
  }

  return ['mail'];
}

function nameOf(value: any): string {
  if (typeof value === 'string') {
    return value;
  }

  return value?.constructor?.name ?? '<notification>';
}

function notifiableName(notifiable: any): string {
  return notifiable?.constructor?.name
    ? `${notifiable.constructor.name}#${String(notifiable.id ?? notifiable.getAuthIdentifier?.() ?? '?')}`
    : String(notifiable);
}

/**
 * Install a fresh notification fake recorder
 */
export function createNotificationFake(): NotificationFake {
  return new NotificationFake();
}
