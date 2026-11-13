/**
 * Logging contracts
 *
 * The shared vocabulary between the three collaborating pieces of the
 * logging stack, kept deliberately split (SRP):
 *
 * - a `Logger` decides *what* gets logged (levels, context, thresholds),
 * - a `Formatter` decides *how* a record looks on the page,
 * - a `Handler` decides *where* the formatted line goes.
 */

/**
 * PSR-3 log levels, ordered from least to most severe.
 * Laravel: Monolog\Logger level constants / Psr\Log\LogLevel
 */
export type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

/**
 * Severity weights (Monolog's numbering) used for threshold comparisons:
 * a message is only handled when its number is >= the channel's threshold.
 */
export const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 100,
  info: 200,
  notice: 250,
  warning: 300,
  error: 400,
  critical: 500,
  alert: 550,
  emergency: 600,
};

/**
 * Resolve the numeric severity of a level name, tolerating config strings.
 */
export function levelNumber(level: LogLevel | string): number {
  return isLogLevel(level) ? LOG_LEVELS[level] : LOG_LEVELS.debug;
}

/**
 * Narrow an arbitrary config value onto a valid PSR-3 level name.
 */
export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && value in LOG_LEVELS;
}

/**
 * A single log entry, already interpolated, handed to a handler for output.
 * Laravel: Monolog\LogRecord
 */
export interface LogRecord {
  /** When the entry was created; daily rotation names files from this */
  time: Date;
  /** PSR-3 level name */
  level: LogLevel;
  /** Message with {placeholders} replaced from context */
  message: string;
  /** Structured data behind the message (logger context + call context) */
  context: Record<string, any>;
  /** Logger label rendered in the line, usually the application name */
  name: string;
  /** Configured channel key the record belongs to, e.g. 'daily' */
  channel: string;
}

/**
 * Where formatted log lines go: files, stderr, nowhere, or other handlers.
 * Laravel: Monolog\Handler\HandlerInterface
 */
export interface Handler {
  /**
   * Output (or delegate) a record. Implementations apply no level logic;
   * thresholds are the Logger's job.
   */
  handle(record: LogRecord): void;

  /**
   * Flush/release any resources the handler holds. Safe to call twice.
   */
  close(): void;
}

/**
 * How a record becomes text. Handlers consult one formatter, and swapping
 * the presentation never touches a handler or the logger (SRP/OCP).
 * Laravel: Monolog\Formatter\FormatterInterface
 */
export interface Formatter {
  /**
   * Render a record as a single line, including the trailing newline.
   */
  format(record: LogRecord): string;
}
