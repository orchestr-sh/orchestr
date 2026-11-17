/**
 * MailChannel - delivers notifications as mail.
 *
 * Mirrors Illuminate\Notifications\Channels\MailChannel, adapted to the
 * Orchestr way: a notification's `toMail()` returns a Mailable (a message
 * description), and this channel hands it to the mail subsystem for
 * rendering and delivery (DRY - no message building, rendering or
 * transport logic lives here; OCP - the channel depends on a structural
 * mailer surface resolved lazily through the container, so `Mail.fake()`
 * or a named `mail.mailers.*` entry swap in without touching notifications).
 *
 * Recipients come from the notifiable's `routeNotificationFor('mail')`
 * - a `routeNotificationForMail()` method, a property of that name, or
 * the usual `email` attribute - and are merged onto whatever the mailable
 * already declares, exactly like `Mailer::send($mailable, $recipients)`.
 */

import type { Mailable } from '@/Mail/Mailable';
import type { RecipientsInput } from '@/Mail/Mailer';
import type { AddressLike } from '@/Mail/MailMessage';
import type { Channel } from '@/Notifications/Contracts/Channel';

/**
 * The structural view of the mail subsystem this channel needs: the
 * MailManager, one of its Mailers, or the MailFake recorder all satisfy
 * it. Resolved lazily so registration order and fakes are irrelevant.
 */
export interface NotificationMailerLike {
  send(mailable: unknown, recipients?: RecipientsInput): Promise<unknown>;
  mailer?(name?: string): { send(mailable: unknown, recipients?: RecipientsInput): Promise<unknown> };
}

export interface MailChannelOptions {
  /**
   * Named mailer (a `mail.mailers` key) to deliver through. Null or
   * absent uses the configured default mailer.
   */
  mailer?: string | null;

  /**
   * Sender applied to notification mail whose Mailable declares no from
   * (config: `notifications.from`)
   */
  from?: { address?: string | null; name?: string | null };
}

export class MailChannel implements Channel {
  constructor(
    protected mailer: () => NotificationMailerLike | null,
    protected options: MailChannelOptions = {}
  ) {}

  /**
   * Render and deliver the notification's mail representation.
   * Laravel: MailChannel::send($notifiable, $notification)
   */
  async send(notifiable: any, notification: any): Promise<unknown> {
    const routes = this.routeFor(notifiable, notification);

    if (routes === null || routes === undefined || (Array.isArray(routes) && routes.length === 0)) {
      throw new Error(`No [mail] routes configured for [${nameOf(notifiable)}].`);
    }

    const mailable = this.messageFor(notification, notifiable);

    if (mailable === null || mailable === undefined) {
      throw new Error(`The [${nameOf(notification)}] notification must have a toMail method.`);
    }

    this.applyConfiguredSender(mailable);

    const mailer = this.mailer();

    if (!mailer) {
      throw new Error('The mail channel requires the mail subsystem. Register the MailServiceProvider first.');
    }

    const target =
      this.options.mailer && typeof mailer.mailer === 'function' ? mailer.mailer(this.options.mailer) : mailer;

    await target.send(mailable, routes as AddressLike | AddressLike[]);

    return mailable;
  }

  /**
   * Where the notification's mail goes: the notifiable's mail route.
   */
  protected routeFor(notifiable: any, notification: any): AddressLike | AddressLike[] | null {
    if (notifiable && typeof notifiable.routeNotificationFor === 'function') {
      return notifiable.routeNotificationFor('mail', notification);
    }

    return null;
  }

  /**
   * Ask the notification for its mail representation.
   */
  protected messageFor(notification: any, notifiable: any): Mailable | Record<string, any> | null {
    if (notification && typeof notification.toMail === 'function') {
      return notification.toMail(notifiable) ?? null;
    }

    return null;
  }

  /**
   * Fall back to `notifications.mail.from` when the Mailable carries no
   * sender of its own - the raw/html paths skip the renderer, so the
   * mailer default would otherwise be the only sender applied.
   */
  protected applyConfiguredSender(mailable: any): void {
    const from = this.options.from;

    if (!from?.address || typeof mailable?.from !== 'function') {
      return;
    }

    if (mailable.from() === undefined || mailable.from() === null) {
      mailable.from(from.address, from.name ?? undefined);
    }
  }
}

/**
 * Human name for error messages: class name when available.
 */
function nameOf(value: any): string {
  return value?.constructor?.name ?? String(value);
}
