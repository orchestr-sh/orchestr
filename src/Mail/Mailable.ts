/**
 * Mailable - the base class for renderable mail messages.
 *
 * Mirrors Laravel's Illuminate\Mail\Mailable. A Mailable only *describes*
 * a message (SRP): its envelope (who it is from, who receives it, the
 * subject), its content (a view, raw HTML/text, or a Markdown template),
 * and its attachments. Delivery is the Mailer's business; configuration
 * belongs to the MailManager.
 *
 * Two declaration styles are supported, matching Laravel's own history:
 *
 * 1. v10-style hooks returning plain config objects:
 *
 *    ```typescript
 *    class WelcomeMail extends Mailable {
 *      envelope() {
 *        return { subject: 'Welcome!', to: this.user.email };
 *      }
 *
 *      content() {
 *        return { view: 'mail.welcome', data: { user: this.user } };
 *      }
 *    }
 *    ```
 *
 * 2. v8-style fluent calls made from the hooks (or a constructor):
 *
 *    ```typescript
 *    class WelcomeMail extends Mailable {
 *      content() {
 *        this.subject('Welcome!').to(this.user).view('mail.welcome').with({ user: this.user });
 *      }
 *    }
 *    ```
 *
 * Every fluent method doubles as a getter when called without arguments,
 * which is how the renderer reads the message back.
 */

import type { AddressLike, AttachmentDefinition, MailAddress } from '@/Mail/MailMessage';
import { normalizeAddress, normalizeAddresses } from '@/Mail/MailMessage';

/**
 * Options accepted by the attachment helpers.
 * Laravel: the `$options` array of Mailable::attach/attachData
 */
export interface AttachmentOptions {
  /** Filename presented to the recipient. */
  as?: string;
  /** Media type; guessed from the filename when omitted. */
  mime?: string;
  /** Alias of `mime`. */
  contentType?: string;
  /** Attach inline (referenced from the HTML body by `cid`). */
  inline?: boolean;
  /** Content id for inline attachments. */
  cid?: string;
}

/**
 * Envelope configuration a hook may return.
 * Laravel: Illuminate\Mail\Envelope
 */
export interface EnvelopeConfig {
  from?: AddressLike;
  to?: AddressLike | AddressLike[];
  cc?: AddressLike | AddressLike[];
  bcc?: AddressLike | AddressLike[];
  replyTo?: AddressLike | AddressLike[];
  subject?: string;
  headers?: Record<string, string>;
}

/**
 * Content configuration a hook may return.
 * Laravel: Illuminate\Mail\Content
 */
export interface ContentConfig {
  /** HTML view name, e.g. 'mail.welcome'. */
  view?: string;
  /** Data passed to the view (alias of `with`). */
  data?: Record<string, any>;
  /** Raw HTML string, no view involved. */
  html?: string;
  /** Raw plain-text string. */
  text?: string;
  /** Markdown view name, rendered through the view system and converted. */
  markdown?: string;
}

/** What `view()` reports back when read as a getter. */
export interface MailViewConfig {
  name: string;
  data: Record<string, any>;
}

export abstract class Mailable {
  // Internal state; the fluent methods below are the only supported way
  // in, which keeps property/method name clashes (a real constraint in
  // TypeScript, unlike PHP) out of the public API.
  protected _from?: MailAddress;
  protected _to: MailAddress[] = [];
  protected _cc: MailAddress[] = [];
  protected _bcc: MailAddress[] = [];
  protected _replyTo: MailAddress[] = [];
  protected _subject?: string;
  protected _headers: Record<string, string> = {};

  protected _view?: string;
  protected _html?: string;
  protected _text?: string;
  protected _markdown?: string;
  protected _contentData: Record<string, any> = {};

  protected _attachments: AttachmentDefinition[] = [];

  /**
   * Define the message envelope: sender, recipients, subject, headers.
   * Either return an EnvelopeConfig or call the fluent setters on `this`.
   * Laravel: Mailable::envelope()
   */
  envelope(): EnvelopeConfig | void {
    // No-op by default; override to declare the envelope.
  }

  /**
   * Define the message content: view / HTML / text / markdown plus data.
   * Either return a ContentConfig or call the fluent setters on `this`.
   * Laravel: Mailable::content()
   */
  content(): ContentConfig | void {
    // No-op by default; override to declare the content.
  }

  /**
   * Additional attachments gathered at render time.
   * Laravel: Mailable::attachments()
   */
  attachments(): AttachmentDefinition[] {
    return [];
  }

  // ==================== Envelope fluent setters / getters ====================

  /**
   * Get or set the sender.
   * Laravel: Mailable::from()
   */
  from(): MailAddress | undefined;
  from(address: AddressLike, name?: string): this;
  from(address?: AddressLike, name?: string): MailAddress | undefined | this {
    if (address === undefined) {
      return this._from;
    }

    this._from = normalizeAddress(address);

    if (name !== undefined) {
      this._from.name = name;
    }

    return this;
  }

  /**
   * Get or add primary recipients.
   * Laravel: Mailable::to()
   */
  to(): MailAddress[];
  to(...recipients: Array<AddressLike | AddressLike[]>): this;
  to(...recipients: Array<AddressLike | AddressLike[]>): MailAddress[] | this {
    if (recipients.length === 0) {
      return this._to;
    }

    this._to.push(...normalizeAddresses(recipients));

    return this;
  }

  /**
   * Get or add CC recipients.
   * Laravel: Mailable::cc()
   */
  cc(): MailAddress[];
  cc(...recipients: Array<AddressLike | AddressLike[]>): this;
  cc(...recipients: Array<AddressLike | AddressLike[]>): MailAddress[] | this {
    if (recipients.length === 0) {
      return this._cc;
    }

    this._cc.push(...normalizeAddresses(recipients));

    return this;
  }

  /**
   * Get or add BCC recipients.
   * Laravel: Mailable::bcc()
   */
  bcc(): MailAddress[];
  bcc(...recipients: Array<AddressLike | AddressLike[]>): this;
  bcc(...recipients: Array<AddressLike | AddressLike[]>): MailAddress[] | this {
    if (recipients.length === 0) {
      return this._bcc;
    }

    this._bcc.push(...normalizeAddresses(recipients));

    return this;
  }

  /**
   * Get or set the reply-to address(es).
   * Laravel: Mailable::replyTo()
   */
  replyTo(): MailAddress[];
  replyTo(...addresses: Array<AddressLike | AddressLike[]>): this;
  replyTo(...addresses: Array<AddressLike | AddressLike[]>): MailAddress[] | this {
    if (addresses.length === 0) {
      return this._replyTo;
    }

    this._replyTo.push(...normalizeAddresses(addresses));

    return this;
  }

  /**
   * Get or set the subject line.
   * Laravel: $mailable->subject (set in envelope())
   */
  subject(): string | undefined;
  subject(text: string): this;
  subject(text?: string): string | undefined | this {
    if (text === undefined) {
      return this._subject;
    }

    this._subject = text;

    return this;
  }

  /**
   * Get or merge extra headers.
   * Laravel: $headers property / Mailable::withHeaders()
   */
  header(): Record<string, string>;
  header(name: string, value: string): this;
  header(name?: string, value?: string): Record<string, string> | this {
    if (name === undefined) {
      return this._headers;
    }

    this._headers[name] = String(value);

    return this;
  }

  // ==================== Content fluent setters / getters ====================

  /**
   * Get or set the HTML view and its data.
   * Laravel: Mailable::view()
   */
  view(): MailViewConfig | undefined;
  view(name: string, data?: Record<string, any>): this;
  view(name?: string, data?: Record<string, any>): MailViewConfig | undefined | this {
    if (name === undefined) {
      return this._view === undefined ? undefined : { name: this._view, data: this._contentData };
    }

    this._view = name;

    if (data) {
      Object.assign(this._contentData, data);
    }

    return this;
  }

  /**
   * Get or set a raw HTML body.
   * Laravel: Mailable::html()
   */
  html(): string | undefined;
  html(content: string): this;
  html(content?: string): string | undefined | this {
    if (content === undefined) {
      return this._html;
    }

    this._html = content;

    return this;
  }

  /**
   * Get or set a raw plain-text body.
   * Laravel: Mailable::text()
   */
  text(): string | undefined;
  text(content: string): this;
  text(content?: string): string | undefined | this {
    if (content === undefined) {
      return this._text;
    }

    this._text = content;

    return this;
  }

  /**
   * Get or set the Markdown view name and data. The view is rendered
   * through the view system and converted to HTML; the rendered template
   * itself becomes the plain-text part.
   * Laravel: Mailable::markdown()
   */
  markdown(): MailViewConfig | undefined;
  markdown(name: string, data?: Record<string, any>): this;
  markdown(name?: string, data?: Record<string, any>): MailViewConfig | undefined | this {
    if (name === undefined) {
      return this._markdown === undefined ? undefined : { name: this._markdown, data: this._contentData };
    }

    this._markdown = name;

    if (data) {
      Object.assign(this._contentData, data);
    }

    return this;
  }

  /**
   * Get or add view data.
   * Laravel: Mailable::with()
   */
  with(): Record<string, any>;
  with(data: Record<string, any>): this;
  with(data?: Record<string, any>): Record<string, any> | this {
    if (data === undefined) {
      return this._contentData;
    }

    Object.assign(this._contentData, data);

    return this;
  }

  // ==================== Attachments ====================

  /**
   * Attach a file from the local filesystem.
   * Laravel: Mailable::attach()
   */
  attach(path: string, options: AttachmentOptions = {}): this {
    this._attachments.push(attachmentFromOptions({ path }, options));

    return this;
  }

  /**
   * Attach raw data (a Buffer or string) under a given filename.
   * Laravel: Mailable::attachData()
   */
  attachData(content: Buffer | string, filename: string, options: AttachmentOptions = {}): this {
    this._attachments.push(attachmentFromOptions({ content, filename }, options));

    return this;
  }

  /**
   * Attach a file from a storage disk. Without an explicit disk the
   * configured `mail.attachments.disk` (default: the default filesystem
   * disk) is used.
   * Laravel: Mailable::attachFromStorage()
   */
  attachFromStorage(path: string, nameOrOptions?: string | AttachmentOptions, options: AttachmentOptions = {}): this {
    const named = typeof nameOrOptions === 'string' ? { as: nameOrOptions } : nameOrOptions;

    this._attachments.push(attachmentFromOptions({ storagePath: path }, { ...(named ?? {}), ...options }));

    return this;
  }

  /**
   * Attach a file from a specific storage disk.
   * Laravel: Mailable::attachFromStorageDisk()
   */
  attachFromStorageDisk(disk: string, path: string, name?: string, options: AttachmentOptions = {}): this {
    this._attachments.push(
      attachmentFromOptions({ storagePath: path, disk }, { ...(name === undefined ? {} : { as: name }), ...options })
    );

    return this;
  }

  /**
   * The attachments declared through the fluent API (the `attachments()`
   * hook result is merged on top by the renderer).
   * Laravel: Mailable::$attachments
   */
  getAttachments(): AttachmentDefinition[] {
    return this._attachments;
  }

  /**
   * Declare an attachment directly (buffer, path or disk definition).
   * Laravel: Mailable::attach/attachData/attachFromStorage internals
   */
  attachment(definition: AttachmentDefinition): this {
    this._attachments.push(definition);

    return this;
  }
}

/**
 * Merge a partial attachment source with the options bag accepted by the
 * attach helpers, normalising `as`/`mime` onto filename/contentType.
 */
function attachmentFromOptions(source: AttachmentDefinition, options: AttachmentOptions): AttachmentDefinition {
  const { as, mime, contentType, inline, cid } = options;

  return {
    ...source,
    filename: as ?? source.filename,
    contentType: mime ?? contentType ?? source.contentType,
    inline: inline ?? source.inline,
    cid: cid ?? source.cid,
  };
}
