/**
 * NotificationSent Event
 *
 * Dispatched after a notification has been delivered on a channel - one
 * event per channel, carrying whatever that channel returned.
 * Mirrors Illuminate\Notifications\Events\NotificationSent.
 */

export class NotificationSent {
  constructor(
    /** The entity that was notified */
    public readonly notifiable: any,

    /** The notification instance that was delivered */
    public readonly notification: any,

    /** The channel the notification went out on */
    public readonly channel: string,

    /** The channel's response, if any */
    public readonly response: unknown = null
  ) {}
}
