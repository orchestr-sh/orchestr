/**
 * NotificationFailed Event
 *
 * Dispatched when a notification could not be delivered on a channel -
 * the data bag carries the error the channel raised.
 * Mirrors Illuminate\Notifications\Events\NotificationFailed.
 */

export class NotificationFailed {
  constructor(
    /** The entity that was being notified */
    public readonly notifiable: any,

    /** The notification instance that failed */
    public readonly notification: any,

    /** The channel delivery failed on */
    public readonly channel: string,

    /** Context describing the failure */
    public readonly data: Record<string, any> = {}
  ) {}
}
