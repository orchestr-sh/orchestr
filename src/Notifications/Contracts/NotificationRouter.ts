/**
 * Notification Router Contract
 *
 * The surface the notification subsystem exposes to recipients and
 * facades: send (queue-aware), sendNow (always synchronous) and queue.
 * Implemented by both the real NotificationSender and the
 * NotificationFake recorder, so `Notification::fake()` swaps the
 * container's `notifications` binding wholesale without any caller
 * noticing (OCP).
 *
 * Mirrors the callable half of Illuminate\Contracts\Notification\Notification.
 */

export interface NotificationRouterLike {
  /**
   * Send a notification to one or many notifiables, queueing it when the
   * notification is flagged as queueable and a queue is available.
   * Laravel: Notification::send()
   */
  send(notifiables: unknown, notification: unknown, channels?: string | string[]): Promise<void>;

  /**
   * Deliver synchronously, queue markers notwithstanding.
   * Laravel: Notification::sendNow()
   */
  sendNow(notifiables: unknown, notification: unknown, channels?: string | string[]): Promise<void>;

  /**
   * Dispatch delivery through the queue subsystem.
   * Laravel: NotificationSender::queue()
   */
  queue(notifiables: unknown, notification: unknown, channels?: string | string[]): Promise<string>;
}
