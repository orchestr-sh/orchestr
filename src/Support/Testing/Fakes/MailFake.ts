/**
 * MailFake
 *
 * Test double for the mailer: records every message the application sends
 * (or queues) instead of delivering it, and offers Laravel-style
 * assertions. Bound under the `mailer` container key - the Mail facade's
 * fake() swaps the MailManager out wholesale for this recorder.
 *
 * Mirrors Illuminate\Support\Testing\Fakes\MailerFake.
 *
 * @example
 * ```typescript
 * const mail = new MailFake();
 *
 * await mail.to('ada@example.com').send(new WelcomeEmail(user));
 *
 * mail.assertSent(WelcomeEmail, (mailable) => mailable.subject === 'Welcome');
 * mail.assertNotSent(new PasswordReset());
 * ```
 */

import type { AddressLike } from '@/Mail/MailMessage';
import { MailMessage, normalizeAddress } from '@/Mail/MailMessage';

/**
 * A message matched by name, class, instance or predicate
 */
export type MailableMatcher = string | object | ((message: any) => boolean);

/**
 * One recorded send
 */
export interface SentMail {
  /** The mailable (or message payload) that was sent */
  mailable: any;

  /** Recipients the mail was addressed to */
  recipients: string[];
}

/**
 * The fluent chain MailFake::to() hands back - shaped after
 * PendingMail's send/queue/later plus the cc/bcc addressing.
 */
export interface PendingFakeMail {
  send(mailable: any): Promise<void>;
  queue(mailable: any): Promise<void>;
  later(delay: number | Date, mailable: any): Promise<void>;
  cc(...addresses: string[]): PendingFakeMail;
  bcc(...addresses: string[]): PendingFakeMail;
}

export class MailFake {
  /**
   * Every message sent through this fake, in order
   */
  public readonly sent: SentMail[] = [];

  /**
   * Every message queued through this fake, in order
   */
  public readonly queued: SentMail[] = [];

  /**
   * Address the next send() to these recipients
   * Laravel: Mail::to()
   */
  to(...recipients: Array<string | string[]>): PendingFakeMail {
    const flattened = recipients.flat().map(String);
    const cc: string[] = [];
    const bcc: string[] = [];

    const pending: PendingFakeMail = {
      send: async (mailable: any): Promise<void> => {
        this.sent.push({ mailable, recipients: [...flattened, ...cc, ...bcc] });
      },
      queue: async (mailable: any): Promise<void> => {
        this.queued.push({ mailable, recipients: [...flattened, ...cc, ...bcc] });
      },
      later: async (_delay: number | Date, mailable: any): Promise<void> => {
        await pending.queue(mailable);
      },
      cc: (...addresses: string[]): PendingFakeMail => {
        cc.push(...addresses);
        return pending;
      },
      bcc: (...addresses: string[]): PendingFakeMail => {
        bcc.push(...addresses);
        return pending;
      },
    };

    return pending;
  }

  /**
   * Record a raw message like Mailer::raw(); the recorded "mailable" is
   * a `{ subject, html }` stand-in so assertions still have something
   * matching to read.
   * Laravel: Mail::raw()
   */
  async raw(
    subject: string,
    html?: string | ((message: MailMessage) => any),
    callback?: (message: MailMessage) => any
  ): Promise<void> {
    const message = new MailMessage();

    message.subject = subject;

    if (typeof html === 'function') {
      await html(message);
    } else if (html !== undefined) {
      message.html = html;
    }

    if (callback) {
      await callback(message);
    }

    this.sent.push({
      mailable: { subject, html: message.html, message },
      recipients: message.recipients().map((address) => address.address),
    });
  }

  /**
   * Record raw HTML like Mailer::html().
   * Laravel: Mail::html()
   */
  async html(html: string, callback?: (message: MailMessage) => any): Promise<void> {
    await this.raw('', html, callback);
  }

  /**
   * Record raw text like Mailer::text().
   * Laravel: Mail::text()
   */
  async text(text: string, callback?: (message: MailMessage) => any): Promise<void> {
    const message = new MailMessage();

    message.text = text;

    if (callback) {
      await callback(message);
    }

    this.sent.push({
      mailable: { text, message },
      recipients: message.recipients().map((address) => address.address),
    });
  }

  /**
   * Always resolve to the fake itself, mirroring
   * MailManager::mailer() so code paths that name a mailer still record
   * against this fake.
   * Laravel: Mail::mailer()
   */
  mailer(_name?: string): this {
    return this;
  }

  /**
   * Send a mailable to the given recipients
   * Laravel: Mail::send($mailable) / Mail::to(...)->send(...)
   */
  async send(mailable: any, recipients: string[] = []): Promise<void> {
    this.sent.push({ mailable, recipients });
  }

  /**
   * Queue a mailable; the fake records it without dispatching a job
   * Laravel: Mail::queue() / Mail::later()
   */
  async queue(mailable: any, recipients: string[] = []): Promise<void> {
    this.queued.push({ mailable, recipients });
  }

  /**
   * Alias of queue(), like Mail::later()
   */
  async later(_delay: number | Date, mailable: any, recipients: string[] = []): Promise<void> {
    await this.queue(mailable, recipients);
  }

  // ==================== Assertions ====================

  /**
   * Assert a matching mailable was sent
   * Laravel: Mail::assertSent()
   */
  assertSent(matcher: MailableMatcher, callback?: (mailable: any, recipients: string[]) => boolean): void {
    this.assertMatching(this.sent, matcher, callback, 'sent');
  }

  /**
   * Assert no matching mailable was sent
   * Laravel: Mail::assertNotSent()
   */
  assertNotSent(matcher: MailableMatcher, callback?: (mailable: any, recipients: string[]) => boolean): void {
    this.assertNotMatching(this.sent, matcher, callback, 'sent');
  }

  /**
   * Assert a matching mailable was queued
   * Laravel: Mail::assertQueued()
   */
  assertQueued(matcher: MailableMatcher, callback?: (mailable: any, recipients: string[]) => boolean): void {
    this.assertMatching(this.queued, matcher, callback, 'queued');
  }

  /**
   * Assert no matching mailable was queued
   * Laravel: Mail::assertNotQueued()
   */
  assertNotQueued(matcher: MailableMatcher, callback?: (mailable: any, recipients: string[]) => boolean): void {
    this.assertNotMatching(this.queued, matcher, callback, 'queued');
  }

  /**
   * Assert a message was sent to the given recipient (optionally of a
   * matching mailable).
   * Laravel: Mail::assertSentTo()
   */
  assertSentTo(recipient: AddressLike, matcher?: MailableMatcher, callback?: (mailable: any) => boolean): void {
    const matching = this.sentTo(recipient);

    if (matching.length === 0) {
      throw new Error(
        `No mail was sent to [${normalizeAddress(recipient).address}]. Mail sent: ${this.describe(this.sent)}.`
      );
    }

    if (matcher !== undefined) {
      this.assertMatching(matching, matcher, callback, 'sent');
    }
  }

  /**
   * Assert no matching message went to the given recipient.
   * Laravel: Mail::assertNotSentTo()
   */
  assertNotSentTo(recipient: AddressLike, matcher?: MailableMatcher, callback?: (mailable: any) => boolean): void {
    const matching = this.sentTo(recipient);

    if (matcher === undefined) {
      if (matching.length > 0) {
        throw new Error(
          `Mail was unexpectedly sent to [${normalizeAddress(recipient).address}]: ` +
            `${matching.map((record) => describe(record.mailable)).join(', ')}.`
        );
      }

      return;
    }

    this.assertNotMatching(matching, matcher, callback, 'sent');
  }

  /**
   * Assert a mailable was sent exactly this many times
   * Laravel: Mail::assertSentTimes()
   */
  assertSentTimes(matcher: MailableMatcher, times: number): void {
    const count = this.matching(this.sent, matcher).length;

    if (count !== times) {
      throw new Error(`Expected [${describe(matcher)}] to be sent ${times} time(s), but it was sent ${count} time(s).`);
    }
  }

  /**
   * Assert nothing at all was sent or queued
   * Laravel: Mail::assertNothingSent()
   */
  assertNothingSent(): void {
    if (this.sent.length > 0) {
      throw new Error(`Expected no mail to be sent, but ${this.sent.length} message(s) were.`);
    }
  }

  /**
   * Assert nothing was queued
   * Laravel: Mail::assertNothingQueued()
   */
  assertNothingQueued(): void {
    if (this.queued.length > 0) {
      throw new Error(`Expected no mail to be queued, but ${this.queued.length} message(s) were.`);
    }
  }

  // ==================== Internals ====================

  /**
   * Sent records addressed to the given recipient (matched
   * case-insensitively against to/cc/bcc as recorded).
   */
  protected sentTo(recipient: AddressLike): SentMail[] {
    const address = normalizeAddress(recipient).address.toLowerCase();

    return this.sent.filter((record) => record.recipients.some((each) => each.toLowerCase() === address));
  }

  protected matching(records: SentMail[], matcher: MailableMatcher): SentMail[] {
    return records.filter((record) => mailableMatches(record.mailable, matcher));
  }

  protected assertMatching(
    records: SentMail[],
    matcher: MailableMatcher,
    callback: ((mailable: any, recipients: string[]) => boolean) | undefined,
    verb: string
  ): void {
    const matching = this.matching(records, matcher);

    if (matching.length === 0) {
      throw new Error(`No mail [${describe(matcher)}] was ${verb}.\nMail ${verb}: ${this.describe(records)}.`);
    }

    if (callback && !matching.some((record) => callback(record.mailable, record.recipients))) {
      throw new Error(
        `Mail [${describe(matcher)}] was ${verb} ${matching.length} time(s) but none matched the provided callback.`
      );
    }
  }

  protected assertNotMatching(
    records: SentMail[],
    matcher: MailableMatcher,
    callback: ((mailable: any, recipients: string[]) => boolean) | undefined,
    verb: string
  ): void {
    const matching = this.matching(records, matcher);

    if (matching.length === 0) {
      return;
    }

    if (!callback) {
      throw new Error(`Mail [${describe(matcher)}] was unexpectedly ${verb} ${matching.length} time(s).`);
    }

    if (matching.some((record) => callback(record.mailable, record.recipients))) {
      throw new Error(`Mail [${describe(matcher)}] was unexpectedly ${verb} matching the provided callback.`);
    }
  }

  protected describe(records: SentMail[]): string {
    if (records.length === 0) {
      return 'none';
    }

    return records.map((record) => describe(record.mailable)).join(', ');
  }

  /**
   * Forget every recorded message
   */
  reset(): void {
    this.sent.length = 0;
    this.queued.length = 0;
  }
}

/**
 * Determine whether a recorded mailable matches a name/class/instance/
 * predicate matcher
 */
function mailableMatches(mailable: any, matcher: MailableMatcher): boolean {
  if (typeof matcher === 'function' && matcher.prototype === undefined) {
    return (matcher as (message: any) => boolean)(mailable);
  }

  if (typeof matcher === 'string') {
    return mailable?.constructor?.name === matcher;
  }

  if (typeof matcher === 'function') {
    // a class constructor
    return mailable instanceof matcher;
  }

  // an instance: identity or same class
  return mailable === matcher || mailable?.constructor?.name === matcher.constructor?.name;
}

function describe(matcher: MailableMatcher): string {
  if (typeof matcher === 'string') {
    return matcher;
  }

  if (typeof matcher === 'function') {
    return matcher.name || '<anonymous mail>';
  }

  return matcher?.constructor?.name ?? '<mail>';
}
