/**
 * LineFormatter - the default record presentation
 * Laravel: Monolog\Formatter\LineFormatter (the common single-line output)
 *
 * One line per record:
 *
 *   [2026-11-12T17:00:05.375Z] orchestr.ERROR: user 1 {"id":1}
 *
 * The formatter owns "how": timestamp, level, logger name, the already
 * interpolated message, and a JSON dump of the context. Where the line
 * lands is the handler's business alone (SRP).
 */

import type { Formatter, LogRecord } from '@/Log/Contracts/Logging';

export class LineFormatter implements Formatter {
  /**
   * Render one complete log line, newline included.
   */
  format(record: LogRecord): string {
    const line = [
      `[${record.time.toISOString()}]`,
      `${record.name}.${record.level.toUpperCase()}:`,
      record.message,
      this.serialize(record.context),
    ].join(' ');

    return `${line}\n`;
  }

  /**
   * JSON-encode the context, degrading gracefully: Errors keep their
   * name/message/stack (their properties are non-enumerable, so the default
   * stringify would emit `{}`), and circular references become [Circular]
   * instead of throwing inside a log call.
   */
  protected serialize(context: Record<string, any>): string {
    const seen = new WeakSet<object>();

    const revive = (_key: string, value: any): any => {
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }

      if (value !== null && typeof value === 'object') {
        if (seen.has(value)) {
          return '[Circular]';
        }

        seen.add(value);
      }

      return value;
    };

    try {
      return JSON.stringify(context, revive) ?? '{}';
    } catch {
      return '{"unserializable":true}';
    }
  }
}
