/**
 * MailMessage - the rendered message every transport receives.
 *
 * Mirrors Laravel's Illuminate\Mail\Message (the thin wrapper around
 * Symfony's Email): it is *data about a message* - who it is from, who it
 * goes to, what it says and what rides along - with no rendering or
 * delivery logic (SRP: Mailable describes, Mailer sends, transports
 * deliver).
 */

/**
 * An email address with an optional display name.
 * Laravel: Symfony\Component\Mime\Address
 */
export interface MailAddress {
  address: string;
  name?: string;
}

/**
 * Anything the API accepts where an address is expected: a bare address,
 * an object, or the `{ email, name }` shape user code and factories tend
 * to produce. (Laravel's `[email, name]` tuples work too when passed as
 * a single address to `normalizeAddress`, but the list-friendly shapes
 * above are what the fluent APIs accept.)
 */
export type AddressLike = string | MailAddress | { email: string; name?: string };

/**
 * Normalise any accepted address shape onto `{ address, name? }`.
 */
export function normalizeAddress(value: AddressLike | [string, string?]): MailAddress {
  if (typeof value === 'string') {
    return { address: value };
  }

  if (Array.isArray(value)) {
    const [address, name] = value;

    return name === undefined ? { address } : { address, name };
  }

  const address = (value as Partial<MailAddress>).address ?? (value as { email?: string }).email;

  if (!address) {
    throw new Error('A mail address requires an "address" or "email" property.');
  }

  return { address, name: value.name };
}

/**
 * Normalise a mixed bag of address inputs (arrays, spreads, singletons).
 */
export function normalizeAddresses(values: Array<AddressLike | AddressLike[]>): MailAddress[] {
  const result: MailAddress[] = [];

  for (const value of values) {
    if (Array.isArray(value)) {
      for (const entry of value as AddressLike[]) {
        result.push(normalizeAddress(entry));
      }
    } else {
      result.push(normalizeAddress(value));
    }
  }

  return result;
}

/**
 * Render an address for a header line: `Ada Lovelace <ada@example.com>`.
 */
export function formatAddress(address: MailAddress): string {
  return address.name ? `${address.name} <${address.address}>` : address.address;
}

/**
 * An attachment as declared on a mailable: exactly one source of content
 * (buffer/string data, a filesystem path, or a storage disk path) plus the
 * presentation metadata Laravel passes through the `attach` options array.
 * Laravel: Symfony attachment definitions on Illuminate\Mail\Message
 */
export interface AttachmentDefinition {
  /**
   * Filename presented to the recipient; defaults to the path's last
   * segment or "attachment" for raw data.
   */
  filename?: string;

  /**
   * Raw bytes - the `attachData()` source.
   */
  content?: Buffer | string;

  /**
   * Absolute or cwd-relative filesystem path - the `attach()` source.
   */
  path?: string;

  /**
   * Storage disk path - the `attachFromStorage()` source, read through
   * the named disk (or the configured attachments disk).
   */
  disk?: string;
  storagePath?: string;

  /**
   * Media type; guessed from the filename when omitted.
   */
  contentType?: string;

  /**
   * Laravel: `inline: true` renders the file inside the message body.
   */
  inline?: boolean;

  /**
   * Content id referenced by inline HTML (`cid:...`).
   */
  cid?: string;
}

/**
 * A definition with its content resolved to bytes, ready for a transport.
 */
export interface ResolvedAttachment extends AttachmentDefinition {
  filename: string;
  content: Buffer;
}

export class MailMessage {
  from: MailAddress[] = [];

  to: MailAddress[] = [];

  cc: MailAddress[] = [];

  bcc: MailAddress[] = [];

  replyTo: MailAddress[] = [];

  subject = '';

  /**
   * Rendered HTML body; undefined for text-only messages.
   */
  html?: string;

  /**
   * Plain-text body; undefined for HTML-only messages.
   */
  text?: string;

  attachments: ResolvedAttachment[] = [];

  /**
   * Extra headers, e.g. `X-Mailer: Orchestr`.
   */
  headers: Record<string, string> = {};

  /**
   * Add senders/recipients; anything already present is kept, matching
   * Laravel's Message, which appends addresses rather than replacing them.
   */
  addFrom(...addresses: Array<AddressLike | AddressLike[]>): this {
    this.from.push(...normalizeAddresses(addresses));

    return this;
  }

  addTo(...addresses: Array<AddressLike | AddressLike[]>): this {
    this.to.push(...normalizeAddresses(addresses));

    return this;
  }

  addCc(...addresses: Array<AddressLike | AddressLike[]>): this {
    this.cc.push(...normalizeAddresses(addresses));

    return this;
  }

  addBcc(...addresses: Array<AddressLike | AddressLike[]>): this {
    this.bcc.push(...normalizeAddresses(addresses));

    return this;
  }

  addReplyTo(...addresses: Array<AddressLike | AddressLike[]>): this {
    this.replyTo.push(...normalizeAddresses(addresses));

    return this;
  }

  withHeader(name: string, value: string): this {
    this.headers[name] = value;

    return this;
  }

  /**
   * Every recipient across the three address fields, de-duplicated by
   * address - what a transport actually delivers to.
   * Laravel: Envelope::allRecipients()
   */
  recipients(): MailAddress[] {
    const seen = new Map<string, MailAddress>();

    for (const address of [...this.to, ...this.cc, ...this.bcc]) {
      const key = address.address.toLowerCase();

      if (!seen.has(key)) {
        seen.set(key, address);
      }
    }

    return [...seen.values()];
  }

  /**
   * The message as readable text: envelope lines, subject, bodies and a
   * per-attachment summary. The `log` transport writes this to the log,
   * and assertions inspect it.
   * Laravel: Email::toString()
   */
  toString(): string {
    const lines: string[] = [];

    const header = (name: string, addresses: MailAddress[]): void => {
      if (addresses.length > 0) {
        lines.push(`${name}: ${addresses.map(formatAddress).join(', ')}`);
      }
    };

    header('From', this.from);
    header('To', this.to);
    header('Cc', this.cc);
    header('Bcc', this.bcc);
    header('Reply-To', this.replyTo);

    for (const [name, value] of Object.entries(this.headers)) {
      lines.push(`${name}: ${value}`);
    }

    lines.push(`Subject: ${this.subject}`, '');

    if (this.html !== undefined) {
      lines.push('--- HTML ---', this.html, '');
    }

    if (this.text !== undefined) {
      lines.push('--- Text ---', this.text, '');
    }

    if (this.attachments.length > 0) {
      lines.push('--- Attachments ---');

      for (const attachment of this.attachments) {
        lines.push(`${attachment.filename} (${attachment.content.length} bytes)`);
      }
    }

    return lines.join('\n');
  }
}
