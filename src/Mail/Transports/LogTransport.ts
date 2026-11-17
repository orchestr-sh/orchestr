/**
 * LogTransport - writes the rendered message to the log instead of
 * delivering it anywhere.
 *
 * The Laravel `log` mailer: great for local development and for reading
 * exactly what would have been sent. The fully rendered message (headers,
 * subject, bodies, attachments) is handed to the configured Logger as an
 * already-built record so no placeholder interpolation touches the body,
 * and - like `mail.mailers.log.path` - an optional file receives the same
 * dump appended.
 *
 * Mirrors Illuminate\Mail\Transport\LogTransport.
 */

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { Handler, LogRecord } from '@/Log/Contracts/Logging';
import type { Transport } from '@/Mail/Contracts/Transport';
import type { MailMessage } from '@/Mail/MailMessage';
import { LineFormatter } from '@/Log/Formatters/LineFormatter';
import { Logger } from '@/Log/Logger';

export interface LogTransportOptions {
  /**
   * Logger to write through; defaults to a console logger labelled `mail`.
   */
  logger?: Logger;

  /**
   * When set, the rendered message is appended to this file as well as
   * written to the log (Laravel: `mail.mailers.log.path`).
   */
  path?: string;
}

/**
 * The fallback handler when no logger was supplied: one formatted line
 * (multi-line record included) per message on stdout.
 */
class ConsoleMailHandler implements Handler {
  protected formatter = new LineFormatter();

  handle(record: LogRecord): void {
    process.stdout.write(this.formatter.format(record));
  }

  close(): void {
    // nothing to release
  }
}

export class LogTransport implements Transport {
  protected logger: Logger;

  constructor(protected options: LogTransportOptions = {}) {
    this.logger = options.logger ?? new Logger(new ConsoleMailHandler(), { name: 'mail', channel: 'mail' });
  }

  async send(message: MailMessage): Promise<void> {
    const rendered = message.toString();

    if (this.options.path) {
      mkdirSync(dirname(this.options.path), { recursive: true });
      appendFileSync(this.options.path, `${rendered}\n\n`, 'utf-8');
    }

    // Hand the finished record to the logger: the body is emitted exactly
    // as rendered, with {curly} braces untouched.
    this.logger.handle({
      time: new Date(),
      level: 'debug',
      message: rendered,
      context: {
        to: message.recipients().map((address) => address.address),
        subject: message.subject,
      },
      name: this.logger.getName(),
      channel: this.logger.getChannelName(),
    });
  }
}
