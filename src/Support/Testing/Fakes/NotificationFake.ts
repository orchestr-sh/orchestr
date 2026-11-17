/**
 * NotificationFake
 *
 * Test double for the notification router: records every notification the
 * application sends instead of running the channels, and answers
 * Laravel-style assertions about who received what. Bound under the
 * `notifications` container key by the Testing installer, the same key
 * the NotificationSender lives at, so `Notification.fake()` swaps the
 * subsystem wholesale.
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
 * notifications.assertSentTimes(OrderShipped, 1);
 * notifications.assertNotSent(OrderShipped, (n) => n.orderId !== 2);
 * ```
 */

import type { MailableMatcher } from '@/Support/Testing/Fakes/MailFake';
import { AnonymousNotifiable } from '@/Notifications/AnonymousNotifiable';

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
  async send(notifiables: unknown, notification: unknown, channels?: string | string[]): Promise<void> {
    const list = Array.isArray(notifiables) ? [...notifiables] : [notifiables];

    this.sentNotifications.push({
      notifiables: list,
      notification,
      channels: channels === undefined ? inferChannels(notification, list[0]) : normalizeChannels(channels),
    });
  }

  /**
   * Recording alias of send(): the fake never runs channels, so there is
   * nothing to bypass. Present so `sendNow` callers route here unchanged.
   * Laravel: Notification::sendNow()
   */
  async sendNow(notifiables: unknown, notification: unknown, channels?: string | string[]): Promise<void> {
    await this.send(notifiables, notification, channels);
  }

  /**
   * Record a notification that would have been queued. The fake does not
   * touch the queue subsystem - the send is simply remembered.
   * Laravel: NotificationSender::queue() against the fake
   */
  async queue(notifiables: unknown, notification: unknown, channels?: string | string[]): Promise<string> {
    await this.send(notifiables, notification, channels);

    return String(this.sentNotifications.length);
  }

  /**
   * Record an on-demand send: the route bag becomes an
   * AnonymousNotifiable, exactly like the real on-demand flow, so
   * assertSentOnDemand sees a uniform record shape.
   * Laravel: Notification::sendOnDemand() via the anonymous notifiable path
   */
  route(route: Record<string, any>, notification: any): void {
    this.sentNotifications.push({
      notifiables: [new AnonymousNotifiable({ ...route })],
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
   * Assert the total number of notifications recorded
   * Laravel: Notification::assertCount()
   */
  assertCount(times: number): void {
    const actual = this.sentNotifications.length;

    if (actual !== times) {
      throw new Error(`Expected ${times} notification(s) to be sent, but ${actual} were.\nSent: ${this.describe()}`);
    }
  }

  /**
   * Assert a notification was delivered on demand - to an anonymous
   * recipient rather than a notifiable model.
   * Laravel: Notification::assertSentOnDemand()
   */
  assertSentOnDemand(matcher?: MailableMatcher, callback?: (notification: any, notifiable: any) => boolean): void {
    const matching = this.onDemand().filter(
      (record) => matcher === undefined || notificationMatches(record.notification, matcher)
    );

    if (matching.length === 0) {
      throw new Error(
        `No notification [${matcher === undefined ? 'any' : nameOf(matcher)}] was sent on demand.\nSent: ${this.describe()}`
      );
    }

    if (callback && !matching.some((record) => record.notifiables.some((who) => callback(record.notification, who)))) {
      throw new Error(
        `Notification [${matcher === undefined ? 'any' : nameOf(matcher)}] was sent on demand ` +
          `${matching.length} time(s) but none matched the provided callback.`
      );
    }
  }

  /**
   * Assert no matching notification was delivered on demand.
   * Laravel: Notification::assertNotSentOnDemand()
   */
  assertNotSentOnDemand(matcher?: MailableMatcher, callback?: (notification: any) => boolean): void {
    const matching = this.onDemand().filter(
      (record) => matcher === undefined || notificationMatches(record.notification, matcher)
    );

    if (matching.length === 0) {
      return;
    }

    if (!callback) {
      throw new Error(
        `The notification [${matcher === undefined ? 'any' : nameOf(matcher)}] was unexpectedly sent on demand ` +
          `${matching.length} time(s).`
      );
    }

    if (matching.some((record) => callback(record.notification))) {
      throw new Error(
        `Notification [${matcher === undefined ? 'any' : nameOf(matcher)}] was sent on demand ` +
          'matching the provided callback.'
      );
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

  /**
   * Records delivered to anonymous (on-demand) recipients
   */
  protected onDemand(): SentNotification[] {
    return this.sentNotifications.filter((record) =>
      record.notifiables.some((who) => who instanceof AnonymousNotifiable)
    );
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

/**
 * One channel name or many, as a list.
 */
function normalizeChannels(channels: string | string[]): string[] {
  return (Array.isArray(channels) ? channels : [channels]).map(String);
}

function nameOf(value: any): string {
  if (typeof value === 'string') {
    return value;
  }

  // A class matcher is a function: report the class name it stands for.
  if (typeof value === 'function') {
    return value.name || '<notification>';
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
