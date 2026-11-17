/**
 * Notification - the base class for describing a notification.
 *
 * Mirrors Laravel's Illuminate\Notifications\Notification. A Notification
 * only *describes* what should be delivered (SRP): which channels carry it
 * (`via`) and the channel-specific representations (`toMail`, `toDatabase`,
 * `toBroadcast`, `toArray`). Routing to notifiables is the NotificationSender's
 * business; delivery belongs to the channel classes.
 *
 * The channel hooks are declared here as opt-in overrides returning nothing:
 * a notification implements only the representations it wants to offer, and
 * each channel treats the unimplemented default (`undefined`) the way
 * Laravel's `method_exists` checks treat a missing method - it raises a
 * clear error instead of quietly delivering an empty message.
 *
 * Queuing follows the same runtime-marker convention as queued listeners:
 * declare `queued = true` (matching `implements ShouldQueue`, which
 * documents the intent and type-checks the marker) and `Notification::send`
 * routes the notification through the queue subsystem with a
 * SendQueuedNotification job instead of delivering inline. `sendNow` always
 * delivers synchronously.
 *
 * @example
 * ```typescript
 * class InvoicePaid extends Notification {
 *   constructor(private invoice: { id: number; total: string }) {
 *     super();
 *   }
 *
 *   via(notifiable: any): string[] {
 *     return ['mail', 'database'];
 *   }
 *
 *   toMail(notifiable: any) {
 *     return new InvoicePaidMail(this.invoice, notifiable);
 *   }
 *
 *   toDatabase(notifiable: any): Record<string, any> {
 *     return { subject: `Invoice #${this.invoice.id} paid`, total: this.invoice.total };
 *   }
 * }
 * ```
 */

import type { Mailable } from '@/Mail/Mailable';

export class Notification {
  /**
   * Runtime marker flagging the notification as queueable
   *
   * Interfaces vanish at compile time, so the sender honours `queued = true`
   * the way the event dispatcher honours it for queued listeners.
   * Laravel: `implements ShouldQueue` on the notification class.
   */
  public readonly queued?: true;

  /**
   * The channels the notification should be delivered on.
   * Laravel: Notification::via($notifiable) - the make:notification stub
   * defaults to `['mail']`, and so does the base class here.
   *
   * @param _notifiable - The entity being notified
   * @returns Channel names resolved by the NotificationSender
   */
  via(_notifiable: any): string[] {
    return ['mail'];
  }

  /**
   * The mail representation of the notification.
   *
   * Return a Mailable - Orchestr's convention for describing a message -
   * which the mail channel renders through the mail subsystem (DRY: no
   * message building here). The legacy duck-typed mail classes the
   * MessageRenderer still accepts work as return values too.
   * Laravel: Notification::toMail($notifiable)
   */
  toMail(_notifiable: any): Mailable | Record<string, any> | undefined {
    return undefined;
  }

  /**
   * The database representation of the notification: the payload stored on
   * the `data` column of the notifications row. The database channel falls
   * back to `toArray` when this is not overridden.
   * Laravel: Notification::toDatabase($notifiable)
   */
  toDatabase(_notifiable: any): Record<string, any> | undefined {
    return undefined;
  }

  /**
   * The array representation of the notification. Laravel leaves this to
   * subclasses (the make:notification stub returns an array); the database
   * channel reads it as the payload fallback, the broadcast channel as the
   * data fallback.
   * Laravel: Notification::toArray($notifiable)
   */
  toArray(_notifiable: any): Record<string, any> {
    return {};
  }

  /**
   * The broadcast payload of the notification. The broadcast channel falls
   * back to `toArray` when this is not overridden.
   * Laravel: Notification::toBroadcast($notifiable)
   */
  toBroadcast(_notifiable: any): Record<string, any> | undefined {
    return undefined;
  }

  /**
   * The queue connection queueable notifications dispatch on.
   * Laravel: Illuminate\Bus\Queueable::$connection
   */
  viaConnection(): string | null {
    return null;
  }

  /**
   * The queue queueable notifications dispatch on.
   * Laravel: Illuminate\Bus\Queueable::$queue
   */
  viaQueue(): string | null {
    return null;
  }
}
