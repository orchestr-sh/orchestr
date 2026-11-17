/**
 * Mailer - sends messages through a Transport.
 *
 * Mirrors Laravel's Illuminate\Mail\Mailer. The mailer is deliberately
 * thin: rendering is the MessageRenderer's job, transport choice is the
 * MailManager's job (SRP). What stays here is orchestration - render,
 * add addressing, deliver - plus the fluent `to()` entry point, the raw
 * `raw/html/text` helpers, and queueing via SendQueuedMailable.
 *
 * @example
 * ```typescript
 * const mailer = new Mailer(new ArrayTransport(), renderer);
 *
 * await mailer.to('ada@example.com').send(new WelcomeMail(user));
 * await mailer.send(new InvoiceMail(invoice)); // recipients live on the mailable
 * ```
 */

import type { QueueDispatcherLike } from '@/Mail/Contracts/QueueDispatcher';
import type { Transport } from '@/Mail/Contracts/Transport';
import type { AddressLike, MailAddress } from '@/Mail/MailMessage';
import type { MailableLike, MessageRenderer } from '@/Mail/MessageRenderer';
import { MailMessage, normalizeAddresses } from '@/Mail/MailMessage';
import { PendingMail } from '@/Mail/PendingMail';
import { SendQueuedMailable } from '@/Mail/SendQueuedMailable';

/**
 * Extra addressing applied at send time - either a plain recipient list
 * or an explicit `{ to, cc, bcc }` bag as built by PendingMail.
 */
export interface RecipientBag {
  to?: AddressLike[];
  cc?: AddressLike[];
  bcc?: AddressLike[];
}

export type RecipientsInput = AddressLike | AddressLike[] | RecipientBag;

export interface MailerOptions {
  /**
   * Mailer name as configured under `mail.mailers` (for error messages).
   */
  name?: string;

  /**
   * Default sender for messages that do not set one themselves - raw
   * sends skip the renderer, so the mailer applies it here (the
   * renderer covers mailables from the same config value).
   */
  from?: MailAddress;

  /**
   * Lazily resolve the queue manager so `queue()`/`later()` can dispatch
   * SendQueuedMailable jobs. Absent means queueing is unavailable.
   */
  queue?: () => QueueDispatcherLike | null;
}

/**
 * Distinguish the explicit address bag from a single address object
 * (`{ address, name }`) or `{ email, name }`.
 */
function isRecipientBag(input: object): input is RecipientBag {
  return 'to' in input || 'cc' in input || 'bcc' in input;
}

function asBag(input?: RecipientsInput): RecipientBag {
  if (input === undefined || input === null) {
    return {};
  }

  if (typeof input === 'object' && !Array.isArray(input) && isRecipientBag(input)) {
    return input;
  }

  const list = (Array.isArray(input) ? input : [input]) as AddressLike[];

  return list.length > 0 ? { to: list } : {};
}

export class Mailer {
  constructor(
    protected transport: Transport,
    protected renderer: MessageRenderer,
    protected options: MailerOptions = {}
  ) {}

  /**
   * The name of this mailer (`mail.mailers` key), if it was built with one.
   */
  getName(): string | undefined {
    return this.options.name;
  }

  /**
   * The transport behind this mailer - where messages actually go.
   * Laravel: Mailer::getSymfonyTransport()
   */
  getTransport(): Transport {
    return this.transport;
  }

  /**
   * The renderer that turns mailables into messages.
   */
  getRenderer(): MessageRenderer {
    return this.renderer;
  }

  /**
   * Start a pending send to the given recipients.
   * Laravel: Mailer::to()
   */
  to(...recipients: Array<AddressLike | AddressLike[]>): PendingMail {
    const pending = new PendingMail(this);

    return pending.to(...recipients);
  }

  /**
   * Render and deliver a mailable, optionally adding recipients at
   * send time.
   * Laravel: Mailer::send()
   */
  async send(mailable: MailableLike, recipients?: RecipientsInput): Promise<void> {
    const message = await this.renderer.render(mailable);

    this.applyRecipients(message, asBag(recipients));

    await this.deliver(message);
  }

  /**
   * Queue a mailable for delivery by a worker.
   * Laravel: Mailer::queue()
   */
  async queue(mailable: MailableLike, recipients?: RecipientsInput): Promise<string> {
    const job = new SendQueuedMailable(this, mailable, recipients);

    return this.queueManager().dispatch(job);
  }

  /**
   * Queue a mailable with a delay (seconds or an absolute Date).
   * Laravel: Mailer::later()
   */
  async later(delay: number | Date, mailable: MailableLike, recipients?: RecipientsInput): Promise<string> {
    const job = new SendQueuedMailable(this, mailable, recipients);

    job.delay = delay;

    return this.queueManager().dispatch(job);
  }

  /**
   * Send a raw message: a subject plus an HTML body (string, or built by
   * a callback handed the MailMessage).
   * Laravel: Mailer::raw()
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

    await this.deliver(message);
  }

  /**
   * Send a raw HTML string.
   * Laravel: Mailer::html()
   */
  async html(html: string, callback?: (message: MailMessage) => any): Promise<void> {
    await this.raw('', html, callback);
  }

  /**
   * Send a raw plain-text string.
   * Laravel: Mailer::text()
   */
  async text(text: string, callback?: (message: MailMessage) => any): Promise<void> {
    const message = new MailMessage();

    message.text = text;

    if (callback) {
      await callback(message);
    }

    await this.deliver(message);
  }

  /**
   * The single exit point: fill in the configured sender when the
   * message carries none, then hand it to the transport (DRY - every
   * send path converges here).
   */
  protected async deliver(message: MailMessage): Promise<void> {
    if (message.from.length === 0 && this.options.from) {
      message.addFrom(this.options.from);
    }

    await this.transport.send(message);
  }

  /**
   * Address a rendered message with extra recipients. Addresses already
   * present on the mailable are kept.
   */
  protected applyRecipients(message: MailMessage, bag: RecipientBag): void {
    if (bag.to?.length) {
      message.addTo(...normalizeAddresses(bag.to));
    }

    if (bag.cc?.length) {
      message.addCc(...normalizeAddresses(bag.cc));
    }

    if (bag.bcc?.length) {
      message.addBcc(...normalizeAddresses(bag.bcc));
    }
  }

  /**
   * Resolve the queue manager for queued delivery, failing loudly when
   * mail queueing is not wired up.
   */
  protected queueManager(): QueueDispatcherLike {
    const manager = this.options.queue?.();

    if (!manager) {
      throw new Error(
        'Queueing mail requires the queue subsystem. Register the QueueServiceProvider first, ' +
          'or send the message synchronously with send().'
      );
    }

    return manager;
  }
}
