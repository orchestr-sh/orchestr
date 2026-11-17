/**
 * MessageRenderer - the one path every message travels through.
 *
 * Turns a Mailable (or any legacy duck-typed mail class) into a fully
 * rendered MailMessage: envelope merged from the `envelope()` hook and
 * the fluent setters, bodies rendered through the view system, Markdown
 * converted, attachments resolved from buffers, paths and storage disks.
 *
 * SRP/OCP: the Mailer hands rendering here so delivery stays delivery,
 * and HTML, text and Markdown all share this single render path (DRY) -
 * adding a body type means extending the renderer, not the transports.
 *
 * Mirrors the rendering half of Laravel's Illuminate\Mail\Mailable +
 * Illuminate\Mail\Markdown.
 */

import { readFile } from 'fs/promises';
import { basename } from 'path';
import type { Disk } from '@/Filesystem/Contracts/Disk';
import type { AttachmentDefinition, MailAddress } from '@/Mail/MailMessage';
import type { View } from '@/View/View';
import type { ViewFactory } from '@/View/ViewFactory';
import { FileNotFoundException } from '@/Filesystem/FileNotFoundException';
import { Mailable } from '@/Mail/Mailable';
import { MailMessage, normalizeAddresses } from '@/Mail/MailMessage';
import { markdownToHtml } from '@/Mail/Markdown';
import { guessMimeType } from '@/Support/Mimes';

/** Anything renderable: a Mailable subclass instance or a duck-typed mail class. */
export type MailableLike = any;

export interface RendererOptions {
  /**
   * Lazily resolve the view factory. Returning null means the
   * application has no view layer registered.
   */
  views?: () => ViewFactory | null;

  /**
   * Resolve a storage disk for `attachFromStorage` payloads; the name is
   * the per-attachment disk or the configured attachments disk.
   */
  disks?: (disk?: string) => Disk | null;

  /**
   * Sender applied when the mailable does not set one
   * (config: `mail.from`).
   */
  from?: MailAddress;

  /**
   * Reply-to applied when the mailable does not set one.
   */
  replyTo?: MailAddress;

  /**
   * Disk used by `attachFromStorage()` when no disk is given
   * (config: `mail.attachments.disk`).
   */
  attachmentDisk?: string;
}

/** Shape of an object with a `mail: this` style view attached to content(). */
interface Renderable {
  render(): Promise<string>;
}

function isRenderable(value: unknown): value is Renderable {
  return typeof value === 'object' && value !== null && typeof (value as Renderable).render === 'function';
}

/**
 * Read a hook return value as configuration: `void`/`this` (fluent
 * style) and non-objects contribute nothing, plain objects are the
 * Laravel v10 Envelope/Content shape.
 */
function plainConfig(value: unknown): Record<string, any> {
  if (value === null || value === undefined || typeof value !== 'object') {
    return {};
  }

  if (value instanceof Mailable || isRenderable(value)) {
    return {};
  }

  return value as Record<string, any>;
}

export class MessageRenderer {
  constructor(protected options: RendererOptions = {}) {}

  /**
   * Render a mailable into a transport-ready message.
   */
  async render(mailable: MailableLike): Promise<MailMessage> {
    const message = new MailMessage();

    if (mailable instanceof Mailable) {
      await this.renderMailable(mailable, message);
    } else {
      await this.renderLegacy(mailable, message);
    }

    if (message.from.length === 0 && this.options.from) {
      message.from.push(this.options.from);
    }

    if (message.replyTo.length === 0 && this.options.replyTo) {
      message.replyTo.push(this.options.replyTo);
    }

    return message;
  }

  // ==================== Mailable path ====================

  protected async renderMailable(mailable: Mailable, message: MailMessage): Promise<void> {
    const envelope = plainConfig(mailable.envelope());
    const contentReturn = mailable.content();
    const content = plainConfig(contentReturn);

    // A content() hook may also return the View directly (the shape the
    // old make:mail stub produced) - render that instead of failing on
    // an unexpected config object.
    let returnedViewHtml: string | undefined;

    if (isRenderable(contentReturn)) {
      returnedViewHtml = await contentReturn.render();
    }

    // Addresses: hook-returned config overrides fluent state; both are
    // normalized onto the message in order.
    const from = envelope.from ?? mailable.from();

    if (from) {
      message.addFrom(from);
    }

    this.addIfPresent(message, 'addTo', envelope.to ?? mailable.to());
    this.addIfPresent(message, 'addCc', envelope.cc ?? mailable.cc());
    this.addIfPresent(message, 'addBcc', envelope.bcc ?? mailable.bcc());
    this.addIfPresent(message, 'addReplyTo', envelope.replyTo ?? mailable.replyTo());

    message.subject = envelope.subject ?? mailable.subject() ?? '';

    for (const [name, value] of Object.entries({ ...mailable.header(), ...(envelope.headers ?? {}) })) {
      message.withHeader(name, String(value));
    }

    // Bodies.
    const viewName = content.view ?? mailable.view()?.name;
    const markdownName = content.markdown ?? mailable.markdown()?.name;
    const rawHtml = content.html ?? mailable.html();
    const rawText = content.text ?? mailable.text();
    const data = { mail: mailable, ...mailable.with(), ...content.data };

    if (markdownName !== undefined) {
      const source = await this.renderView(markdownName, data);
      message.html = markdownToHtml(source);
      message.text = rawText ?? source;
    } else if (viewName !== undefined) {
      message.html = await this.renderView(viewName, data);
      message.text = rawText ?? (await this.renderTextSibling(viewName, data));
    } else if (returnedViewHtml !== undefined) {
      message.html = returnedViewHtml;
      message.text = rawText;
    } else {
      message.html = rawHtml;
      message.text = rawText;
    }

    // Attachments: fluent list first, hook additions on top.
    const definitions: AttachmentDefinition[] = [...mailable.getAttachments(), ...mailable.attachments()];

    if (Array.isArray(content.attachments)) {
      definitions.push(...content.attachments);
    }

    message.attachments = await this.resolveAttachments(definitions);
  }

  // ==================== Legacy duck-typed path ====================

  /**
   * Support mail classes written without extending Mailable - e.g. the
   * README's `class WelcomeMail { subject; content(): View }` - by
   * reading the same hook names defensively.
   */
  protected async renderLegacy(mailable: any, message: MailMessage): Promise<void> {
    if (typeof mailable.build === 'function') {
      mailable.build();
    }

    message.subject = typeof mailable.subject === 'string' ? mailable.subject : '';

    const from = mailable.from ?? mailable.fromAddress;

    if (typeof from === 'string' || (from && typeof from === 'object' && !Array.isArray(from))) {
      message.addFrom(from);
    }

    this.addIfPresent(message, 'addTo', mailable.to);
    this.addIfPresent(message, 'addCc', mailable.cc);
    this.addIfPresent(message, 'addBcc', mailable.bcc);

    if (typeof mailable.content === 'function') {
      const content = await mailable.content();

      if (content && typeof content.render === 'function') {
        message.html = await (content as Renderable).render();
      } else if (content && typeof content === 'object') {
        const viewName = content.view ?? content.htmlView;
        const markdownName = content.markdown;
        const data = { mail: mailable, ...content.data };

        if (markdownName !== undefined) {
          const source = await this.renderView(markdownName, data);
          message.html = markdownToHtml(source);
          message.text = content.text ?? source;
        } else if (viewName !== undefined) {
          message.html = await this.renderView(viewName, data);
          message.text = content.text ?? (await this.renderTextSibling(viewName, data));
        } else {
          message.html = content.html;
          message.text = content.text;
        }

        if (Array.isArray(content.attachments)) {
          message.attachments = await this.resolveAttachments(content.attachments);
        }
      }
    } else if (typeof mailable.html === 'string') {
      message.html = mailable.html;
    }

    if (Array.isArray(mailable.attachments) && message.attachments.length === 0) {
      message.attachments = await this.resolveAttachments(mailable.attachments);
    }
  }

  // ==================== Internals ====================

  protected addIfPresent(
    message: MailMessage,
    method: 'addTo' | 'addCc' | 'addBcc' | 'addReplyTo',
    value: unknown
  ): void {
    const list = normalizeAddresses((Array.isArray(value) ? value : [value]).filter((item) => item !== undefined));

    if (list.length > 0) {
      message[method](...list);
    }
  }

  /**
   * Render a named view through the configured view factory.
   */
  protected async renderView(name: string, data: Record<string, any>): Promise<string> {
    const factory = this.options.views?.();

    if (!factory) {
      throw new Error(
        `Cannot render mail view [${name}]: no view layer is registered. Register the ViewServiceProvider first.`
      );
    }

    const view: View = factory.make(name, data);

    return view.render();
  }

  /**
   * Laravel's text-part convention adapted to dot-notation views: a
   * sibling `<view>.text` template - `emails.welcome.text`, resolving to
   * `resources/views/emails/welcome/text.html`, beside
   * `resources/views/emails/welcome.html` - is rendered when present.
   */
  protected async renderTextSibling(viewName: string, data: Record<string, any>): Promise<string | undefined> {
    const factory = this.options.views?.();

    if (!factory || !factory.exists(`${viewName}.text`)) {
      return undefined;
    }

    return this.renderView(`${viewName}.text`, data);
  }

  /**
   * Turn attachment definitions into resolved attachments, reading
   * buffers, filesystem paths and storage disks through one path (DRY).
   */
  protected async resolveAttachments(definitions: AttachmentDefinition[]): Promise<MailMessage['attachments']> {
    const resolved: MailMessage['attachments'] = [];

    for (const definition of definitions) {
      resolved.push(await this.resolveAttachment(definition));
    }

    return resolved;
  }

  protected async resolveAttachment(definition: AttachmentDefinition): Promise<MailMessage['attachments'][number]> {
    let content: Buffer;
    let filename = definition.filename;

    if (definition.content !== undefined) {
      content = Buffer.isBuffer(definition.content) ? definition.content : Buffer.from(String(definition.content));
      filename ??= 'attachment';
    } else if (definition.path !== undefined) {
      try {
        content = await readFile(definition.path);
      } catch (error) {
        throw new FileNotFoundException(definition.path, { cause: error });
      }

      filename ??= basename(definition.path);
    } else if (definition.storagePath !== undefined) {
      const disk = this.options.disks?.(definition.disk ?? this.options.attachmentDisk);

      if (!disk) {
        throw new Error(
          `Cannot attach [${definition.storagePath}] from storage: no filesystem disk is registered. ` +
            'Register the FilesystemServiceProvider first.'
        );
      }

      const contents = await disk.get(definition.storagePath);

      if (contents === null) {
        throw new FileNotFoundException(definition.storagePath);
      }

      content = contents;
      filename ??= basename(definition.storagePath);
    } else {
      throw new Error('An attachment needs content, a path, or a storagePath.');
    }

    const contentType = definition.contentType ?? guessMimeType(filename) ?? undefined;

    return { ...definition, filename, content, contentType };
  }
}
