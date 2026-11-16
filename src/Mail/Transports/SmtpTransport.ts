/**
 * SmtpTransport - delivers messages over SMTP.
 *
 * nodemailer is an optional peer dependency (like ioredis for the redis
 * queue driver): the module is only imported - and therefore only
 * required - when a message is actually delivered, and a client can be
 * injected instead to control the connection yourself or to test the
 * transport without a mail server:
 *
 * ```typescript
 * new SmtpTransport({ host: 'smtp.example.com', port: 587 }, fakeClient);
 * ```
 *
 * Mirrors Laravel's Illuminate\Mail\Transport\SmtpTransport built on top
 * of Symfony's EsmtpTransportFactory; this port speaks to nodemailer's
 * `createTransport` instead of Symfony's SMTP stack.
 */

import type { Transport } from '@/Mail/Contracts/Transport';
import type { MailMessage } from '@/Mail/MailMessage';
import { formatAddress } from '@/Mail/MailMessage';

/**
 * The structural subset of a nodemailer transport used here. Declaring it
 * locally keeps `nodemailer` a true optional dependency (no static
 * import, no compile-time type requirement) and allows injected doubles.
 */
export interface SmtpClient {
  sendMail(mail: SmtpMail): Promise<{ messageId?: string; response?: string }>;
  verify?(): Promise<unknown>;
}

/**
 * The shape nodemailer's `sendMail` accepts (addresses rendered as
 * strings, attachments as content buffers).
 */
export interface SmtpMail {
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject?: string;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string; cid?: string }>;
}

export interface SmtpTransportConfig {
  host?: string;
  port?: number;
  /** Force TLS (`true`), implicit STARTTLS upgrade (`false`/omitted). */
  secure?: boolean;
  auth?: { user: string; pass: string };
  /** Connection timeout in milliseconds. */
  timeout?: number;
  [key: string]: any;
}

export class SmtpTransport implements Transport {
  protected client: SmtpClient | null = null;

  /** Extra options passed straight through to nodemailer's createTransport. */
  protected clientOptions: Record<string, any>;

  constructor(
    protected config: SmtpTransportConfig = {},
    client?: SmtpClient
  ) {
    if (client) {
      this.client = client;
    }

    // `client` is an injection seam for tests and custom connections, not
    // a nodemailer option; drop it from the transport config.
    const { host, port, secure, auth, timeout, client: _client, ...rest } = config;

    this.clientOptions = { host, port, secure, auth, timeout, ...rest };
  }

  /**
   * The client used for delivery, lazily created from nodemailer.
   */
  async getClient(): Promise<SmtpClient> {
    if (this.client) {
      return this.client;
    }

    this.client = await this.createNodemailerClient();

    return this.client;
  }

  async send(message: MailMessage): Promise<void> {
    const client = await this.getClient();

    await client.sendMail(this.toMail(message));
  }

  /**
   * Map a rendered message onto nodemailer's mail options.
   */
  toMail(message: MailMessage): SmtpMail {
    const join = (addresses: MailMessage['to']): string | undefined =>
      addresses.length > 0 ? addresses.map(formatAddress).join(', ') : undefined;

    const mail: SmtpMail = {};

    const from = join(message.from);

    if (from) {
      mail.from = from;
    }

    mail.to = join(message.recipients()) ?? '';
    mail.cc = join(message.cc);
    mail.bcc = join(message.bcc);
    mail.replyTo = join(message.replyTo);
    mail.subject = message.subject;
    mail.html = message.html;
    mail.text = message.text;
    mail.headers = Object.keys(message.headers).length > 0 ? message.headers : undefined;

    if (message.attachments.length > 0) {
      mail.attachments = message.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
        cid: attachment.inline ? (attachment.cid ?? attachment.filename) : attachment.cid,
      }));
    }

    return mail;
  }

  /**
   * Dynamically import the optional nodemailer peer dependency and build
   * a transport from the host/port/auth configuration.
   */
  protected async createNodemailerClient(): Promise<SmtpClient> {
    const moduleName = 'nodemailer';

    let nodemailer: { createTransport: (options: Record<string, any>) => SmtpClient };

    try {
      // Non-literal specifier: keeps nodemailer a genuine optional
      // dependency that is never resolved (or type-checked) unless an SMTP
      // mailer is actually used. Same trick as the redis queue driver.
      nodemailer = await import(moduleName);
    } catch {
      throw new Error(
        "The smtp mail transport requires the 'nodemailer' package. Install it with `npm install nodemailer` " +
          'or provide a client via the transport constructor/config.'
      );
    }

    return nodemailer.createTransport(this.clientOptions);
  }
}
