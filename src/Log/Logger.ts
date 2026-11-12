/**
 * Logger - the PSR-3 workhorse every channel is built around
 * Laravel: Illuminate\Log\Logger (Monolog wrapper); levels come from
 * Psr\Log\LoggerInterface
 *
 * A Logger answers "what gets logged": it applies the channel's level
 * threshold, interpolates {placeholders} from context (PSR-3), and hands a
 * finished LogRecord to its handler - the handler decides where the line
 * goes and the formatter decides how it looks (SRP). Loggers are cheap to
 * derive: withContext/withName/withChannel return new instances and never
 * mutate the original, so a per-service logger can be specialised without
 * touching the shared channel.
 *
 * @example
 * ```typescript
 * logger.info('user {id} signed in', { id: 1 });
 * const billing = logger.withName('billing').withContext({ tenant: 9 });
 * billing.error('charge failed', { exception });
 * ```
 */

import type { Handler, LogRecord, LogLevel } from '@/Log/Contracts/Logging';
import { levelNumber } from '@/Log/Contracts/Logging';

/**
 * Options accepted when building a Logger; every field has a sane default
 * so handlers can be driven directly in tests without a manager.
 */
export interface LoggerOptions {
  /** Minimum severity that reaches the handler; defaults to 'debug' */
  level?: LogLevel;
  /** Label rendered before the level, e.g. the application name */
  name?: string;
  /** Configured channel key this logger writes to */
  channel?: string;
  /** Context merged into every record and available to interpolation */
  context?: Record<string, any>;
  /** Resolves a sibling channel's logger; supplied by LogManager */
  resolveChannel?: (channel: string) => Logger;
}

const DEFAULT_NAME = 'orchestr';

export class Logger {
  protected handler: Handler;

  /** Threshold kept as the original name so derived clones round-trip it */
  protected level: LogLevel;

  protected threshold: number;

  protected name: string;

  protected channel: string;

  protected context: Record<string, any>;

  protected resolveChannel?: (channel: string) => Logger;

  constructor(handler: Handler, options: LoggerOptions = {}) {
    this.handler = handler;
    this.level = options.level ?? 'debug';
    this.threshold = levelNumber(this.level);
    this.name = options.name ?? DEFAULT_NAME;
    this.channel = options.channel ?? 'single';
    this.context = options.context ?? {};
    this.resolveChannel = options.resolveChannel;
  }

  /**
   * Log with an arbitrary PSR-3 level; the level methods below are the
   * usual entry points.
   * Laravel: Logger::log()
   */
  log(level: LogLevel, message: unknown, context: Record<string, any> = {}): void {
    if (!this.isEnabled(level)) {
      return;
    }

    const merged = { ...this.context, ...context };

    this.write({
      time: new Date(),
      level,
      message: Logger.interpolate(Logger.toMessage(message), merged),
      context: merged,
      name: this.name,
      channel: this.channel,
    });
  }

  emergency(message: unknown, context?: Record<string, any>): void {
    this.log('emergency', message, context);
  }

  alert(message: unknown, context?: Record<string, any>): void {
    this.log('alert', message, context);
  }

  critical(message: unknown, context?: Record<string, any>): void {
    this.log('critical', message, context);
  }

  /**
   * PSR-3 error level. Named `error` like Monolog's logger; framework code
   * that also has an `error()` method calls this one through `log()`.
   */
  error(message: unknown, context?: Record<string, any>): void {
    this.log('error', message, context);
  }

  warning(message: unknown, context?: Record<string, any>): void {
    this.log('warning', message, context);
  }

  notice(message: unknown, context?: Record<string, any>): void {
    this.log('notice', message, context);
  }

  info(message: unknown, context?: Record<string, any>): void {
    this.log('info', message, context);
  }

  debug(message: unknown, context?: Record<string, any>): void {
    this.log('debug', message, context);
  }

  /**
   * Re-emit an already-built record through this logger's threshold. Stack
   * channels fan out by calling it on each child, so per-channel thresholds
   * still apply while interpolation happens exactly once (DRY).
   */
  handle(record: LogRecord): void {
    if (!this.isEnabled(record.level)) {
      return;
    }

    this.write(record);
  }

  /**
   * Determine whether a level clears this logger's threshold.
   * Laravel: Monolog threshold comparison
   */
  isEnabled(level: LogLevel | string): boolean {
    return levelNumber(level) >= this.threshold;
  }

  /**
   * Derive a logger carrying extra context; existing keys are overwritten,
   * the original logger is untouched.
   * Laravel: Monolog\Logger::withContext / Log::withContext
   */
  withContext(context: Record<string, any>): Logger {
    return this.clone({ context: { ...this.context, ...context } });
  }

  /**
   * Derive a logger rendering under a different label, e.g. the service the
   * lines belong to.
   * Laravel: Monolog\Logger::withName
   */
  withName(name: string): Logger {
    return this.clone({ name });
  }

  /**
   * Send to a different configured channel while keeping this logger's
   * name and context. Loggers built without a LogManager - plain `new
   * Logger(handler)` - have no sibling channels to switch to and say so.
   */
  withChannel(channel: string): Logger {
    if (!this.resolveChannel) {
      throw new Error(
        `Logger for channel [${this.channel}] cannot switch to [${channel}]: it was built without a channel resolver.`
      );
    }

    return this.resolveChannel(channel).withName(this.name).withContext(this.context);
  }

  /**
   * Access the underlying handler (where output goes).
   */
  getHandler(): Handler {
    return this.handler;
  }

  /**
   * Current level threshold name.
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Current logger label.
   */
  getName(): string {
    return this.name;
  }

  /**
   * Channel key this logger writes to.
   */
  getChannelName(): string {
    return this.channel;
  }

  /**
   * The configured context, for deriving loggers and inspection.
   */
  getContext(): Record<string, any> {
    return this.context;
  }

  /**
   * Hand a finished record to the handler.
   */
  protected write(record: LogRecord): void {
    this.handler.handle(record);
  }

  /**
   * Build a sibling logger overriding the given options; anything not
   * overridden carries over.
   */
  protected clone(overrides: Partial<LoggerOptions>): Logger {
    return new Logger(this.handler, {
      level: overrides.level ?? this.level,
      name: overrides.name ?? this.name,
      channel: overrides.channel ?? this.channel,
      context: overrides.context ?? this.context,
      resolveChannel: this.resolveChannel,
    });
  }

  /**
   * PSR-3 interpolation: every `{key}` whose key exists in context is
   * replaced by that value rendered as text; unknown placeholders and
   * escaped `\{literal\}` braces survive untouched.
   * Laravel: Psr\Log\LoggerInterface section 1.2
   */
  static interpolate(message: string, context: Record<string, any>): string {
    return message.replace(/\\?\{(\w+)\}/g, (match, key: string) => {
      if (match.startsWith('\\')) {
        return match.slice(1);
      }

      if (!(key in context)) {
        return match;
      }

      return Logger.toText(context[key]);
    });
  }

  /**
   * Normalise a PSR-3 message (string|Stringable) onto text; thrown Errors
   * render as their own message so `Log.error(exception)` stays readable.
   */
  static toMessage(message: unknown): string {
    if (typeof message === 'string') {
      return message;
    }

    if (message instanceof Error) {
      return message.message || message.name;
    }

    return Logger.toText(message);
  }

  /**
   * Render any context value as text for placeholder substitution.
   */
  static toText(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    if (value instanceof Error) {
      return `${value.name}: ${value.message}`;
    }

    if (value === null) {
      return 'null';
    }

    if (typeof value === 'object') {
      try {
        return JSON.stringify(value) ?? String(value);
      } catch {
        return String(value);
      }
    }

    return String(value);
  }
}
