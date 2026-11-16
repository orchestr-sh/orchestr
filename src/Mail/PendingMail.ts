/**
 * PendingMail - the fluent `Mail::to(...)->send(...)` builder.
 *
 * Mirrors Laravel's Illuminate\Mail\PendingMail: collect the addressing
 * for one send, then hand the mailable to the mailer with it.
 */

import type { Mailer } from '@/Mail/Mailer';
import type { AddressLike } from '@/Mail/MailMessage';

export class PendingMail {
  protected toList: AddressLike[] = [];
  protected ccList: AddressLike[] = [];
  protected bccList: AddressLike[] = [];

  constructor(protected mailer: Mailer) {}

  /**
   * Add (primary) recipients.
   * Laravel: PendingMail::to()
   */
  to(...recipients: Array<AddressLike | AddressLike[]>): this {
    this.toList.push(...recipients.flat());

    return this;
  }

  /**
   * Add CC recipients.
   * Laravel: PendingMail::cc()
   */
  cc(...recipients: Array<AddressLike | AddressLike[]>): this {
    this.ccList.push(...recipients.flat());

    return this;
  }

  /**
   * Add BCC recipients.
   * Laravel: PendingMail::bcc()
   */
  bcc(...recipients: Array<AddressLike | AddressLike[]>): this {
    this.bccList.push(...recipients.flat());

    return this;
  }

  /**
   * Send the mailable now.
   * Laravel: PendingMail::send()
   */
  async send(mailable: any): Promise<void> {
    await this.mailer.send(mailable, this.addressing());
  }

  /**
   * Queue the mailable on the configured queue connection.
   * Laravel: PendingMail::queue()
   */
  async queue(mailable: any): Promise<string> {
    return this.mailer.queue(mailable, this.addressing());
  }

  /**
   * Queue the mailable with a delay.
   * Laravel: PendingMail::later()
   */
  async later(delay: number | Date, mailable: any): Promise<string> {
    return this.mailer.later(delay, mailable, this.addressing());
  }

  /**
   * The collected addressing as an explicit address bag.
   */
  addressing(): { to?: AddressLike[]; cc?: AddressLike[]; bcc?: AddressLike[] } {
    const bag: { to?: AddressLike[]; cc?: AddressLike[]; bcc?: AddressLike[] } = {};

    if (this.toList.length > 0) {
      bag.to = this.toList;
    }

    if (this.ccList.length > 0) {
      bag.cc = this.ccList;
    }

    if (this.bccList.length > 0) {
      bag.bcc = this.bccList;
    }

    return bag;
  }
}
