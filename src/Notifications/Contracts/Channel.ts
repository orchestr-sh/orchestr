/**
 * Channel Contract
 *
 * The seam between the notification subsystem and the transports that
 * actually deliver notifications (OCP): the NotificationSender resolves
 * a channel by name and hands it the recipient and the notification -
 * it never knows or cares how a mail, database or broadcast message is
 * built. New delivery mechanisms plug in through
 * `NotificationSender::extend()` without touching the sender.
 *
 * Mirrors Illuminate\Contracts\Notification\Channel.
 */

export interface Channel {
  /**
   * Deliver the notification to one notifiable.
   *
   * The return value becomes the `response` reported on the
   * NotificationSent event - a delivered DatabaseNotification row, a
   * broadcast payload, or null when the notification carried nothing to
   * send (no route, for instance).
   *
   * @param notifiable - The entity being notified (a Notifiable model or an AnonymousNotifiable)
   * @param notification - The notification instance describing the message
   * @returns The channel's response, if any
   */
  send(notifiable: any, notification: any): Promise<unknown>;
}

/**
 * A channel factory, as accepted by `NotificationSender::extend()`
 * Laravel: Container binding of a channel implementation
 */
export type ChannelFactory = () => Channel;
