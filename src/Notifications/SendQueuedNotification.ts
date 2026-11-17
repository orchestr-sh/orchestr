/**
 * SendQueuedNotification - the queue payload that carries a notification
 * to a worker for delivery.
 *
 * Mirrors Laravel's Illuminate\Notifications\SendQueuedNotifications. The
 * job holds a live reference to the sender (and through it, the channel
 * registry), so the sync driver and `Queue.fake()` deliver/record it
 * exactly like `send()`; queue drivers that round-trip payloads through
 * JSON cannot restore a notification's class behaviour, which is why
 * queued delivery is scoped to in-process execution for now - the same
 * limitation documented for SendQueuedMailable.
 *
 * The reference fields are underscore-prefixed so `Job.toJSON()` skips
 * them instead of corrupting payloads.
 */

import { Job } from '@/Queue/Job';

export class SendQueuedNotification extends Job {
  protected _sender: any;
  protected _notifiables: unknown[];
  protected _notification: unknown;
  protected _channels?: string[];

  constructor(sender: any, notifiables: unknown[], notification: unknown, channels?: string[]) {
    super();

    this._sender = sender;
    this._notifiables = notifiables;
    this._notification = notification;
    this._channels = channels;
  }

  /**
   * The notification waiting to be delivered (inspection in tests and
   * workers).
   */
  get notification(): unknown {
    return this._notification;
  }

  /**
   * The notifiables the notification goes to.
   */
  get notifiables(): unknown[] {
    return this._notifiables;
  }

  /**
   * The channels to deliver on, when the send pinned them.
   */
  get channels(): string[] | undefined {
    return this._channels;
  }

  /**
   * The sender that will deliver it.
   */
  get sender(): any {
    return this._sender;
  }

  async handle(): Promise<void> {
    // sendNow, never send: a queued notification already made it through
    // the queue once, and must not re-queue itself when the worker runs it.
    await this._sender.sendNow(this._notifiables, this._notification, this._channels);
  }
}
