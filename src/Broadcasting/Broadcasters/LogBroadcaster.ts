/**
 * LogBroadcaster - records broadcasts to the log instead of delivering them.
 *
 * Laravel's `log` broadcast driver: perfect for local development and for
 * seeing exactly what would go out, and never silently swallowing a broadcast.
 * The formatted line goes to the injected logger (defaulting to a console
 * handler labelled `broadcast`) and is kept in `messages` for inspection.
 *
 * Mirrors Illuminate\Broadcasting\Broadcasters\LogBroadcaster.
 */

import type { ChannelAuthorizer } from '@/Broadcasting/ChannelAuthorizer';
import type { Channel } from '@/Broadcasting/Channels';
import type { BroadcastPayload } from '@/Broadcasting/Contracts/Broadcaster';
import type { Handler, LogRecord } from '@/Log/Contracts/Logging';
import { AbstractBroadcaster } from '@/Broadcasting/Broadcasters/Broadcaster';
import { LineFormatter } from '@/Log/Formatters/LineFormatter';
import { Logger } from '@/Log/Logger';

/**
 * One recorded broadcast: the driver-facing triple the log driver captured.
 */
export interface LoggedBroadcast {
  channels: string[];
  event: string;
  payload: Record<string, any>;
}

/**
 * The logger surface the driver writes through; a Logger or any compatible
 * object, so tests can inject a recorder.
 */
export interface BroadcastLogger {
  info(message: unknown, context?: Record<string, any>): void;
}

export interface LogBroadcasterOptions {
  logger?: BroadcastLogger;

  /** The shared channel authorizer, when built by a manager */
  authorizer?: ChannelAuthorizer;
}

/**
 * The fallback handler: one formatted line per broadcast on stdout.
 */
class ConsoleBroadcastHandler implements Handler {
  protected formatter = new LineFormatter();

  handle(record: LogRecord): void {
    process.stdout.write(this.formatter.format(record));
  }

  close(): void {
    // nothing to release
  }
}

export class LogBroadcaster extends AbstractBroadcaster {
  /**
   * Every broadcast this driver recorded, in order.
   */
  public readonly messages: LoggedBroadcast[] = [];

  protected logger: BroadcastLogger;

  constructor(options: LogBroadcasterOptions = {}) {
    super(options.authorizer);

    this.logger =
      options.logger ?? new Logger(new ConsoleBroadcastHandler(), { name: 'broadcast', channel: 'broadcast' });
  }

  /**
   * Record the broadcast: the channels, the event name and the JSON payload,
   * exactly like Laravel's "Broadcasting [event] on channels [...]" line.
   */
  broadcast(channels: Channel[], event: string, payload: BroadcastPayload = {}): void {
    const names = channels.map((channel) => channel.toString());

    this.messages.push({ channels: names, event, payload });

    this.logger.info(`Broadcasting [${event}] on channels [${names.join(', ')}]`, {
      channels: names,
      event,
      payload,
    });
  }
}
