/**
 * SendQueuedMailable - the queue payload that carries a mailable to a
 * worker for delivery.
 *
 * Mirrors Laravel's Illuminate\Mail\SendQueuedMailable. The job holds a
 * live reference to the mailer and mailable, so the sync driver and
 * `Queue.fake()` deliver/record it exactly like `send()`; queue drivers
 * that round-trip payloads through JSON cannot restore a mailable's
 * class behaviour, which is why queued delivery is scoped to
 * in-process execution for now. The reference fields are underscore-
 * prefixed so `Job.toJSON()` skips them instead of corrupting payloads.
 */

import type { Mailer, RecipientsInput } from '@/Mail/Mailer';
import { Job } from '@/Queue/Job';

export class SendQueuedMailable extends Job {
  protected _mailer: Mailer;
  protected _mailable: any;
  protected _recipients?: RecipientsInput;

  constructor(mailer: Mailer, mailable: any, recipients?: RecipientsInput) {
    super();

    this._mailer = mailer;
    this._mailable = mailable;
    this._recipients = recipients;
  }

  /**
   * The mailable waiting to be delivered (inspection in tests and
   * workers).
   */
  get mailable(): any {
    return this._mailable;
  }

  /**
   * The mailer that will deliver it.
   */
  get mailer(): Mailer {
    return this._mailer;
  }

  async handle(): Promise<void> {
    await this._mailer.send(this._mailable, this._recipients);
  }
}
