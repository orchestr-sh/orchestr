/**
 * BroadcastFake
 *
 * Test double for the broadcast manager: records every broadcast instead of
 * delivering it, and answers Laravel-style assertions. Bound under the
 * `broadcast` container key by `Broadcast.fake()`, the same key the manager
 * lives at, so the whole subsystem is swapped wholesale.
 *
 * It exposes the same broadcast/queue/authorization surface the real manager
 * does (so the event dispatcher routes broadcasts into it unchanged), while
 * authorization is verified against a real ChannelAuthorizer - meaning a test
 * can `Broadcast.channel(...)` then assert the fake granted or denied it.
 *
 * Mirrors Illuminate\Support\Testing\Fakes\BroadcastFake.
 *
 * @example
 * ```typescript
 * const broadcast = new BroadcastFake();
 *
 * await broadcast.broadcastEvent(new OrderShipped(order));
 *
 * broadcast.assertBroadcast(OrderShipped);
 * broadcast.assertBroadcastOn(['orders.1'], OrderShipped);
 * broadcast.assertNotBroadcast(OrderCancelled);
 * ```
 */

import type { ChannelAuthorizationCallback } from '@/Broadcasting/ChannelAuthorizer';
import type { Channel } from '@/Broadcasting/Channels';
import type { BroadcastAuthRequest, BroadcastPayload } from '@/Broadcasting/Contracts/Broadcaster';
import { ChannelAuthorizer } from '@/Broadcasting/ChannelAuthorizer';
import { normalizeBroadcastEvent } from '@/Broadcasting/Concerns/NormalizesBroadcastEvent';
import { isShouldBroadcast } from '@/Broadcasting/Contracts/ShouldBroadcast';

/**
 * One recorded broadcast: the normalised channels/event/payload plus the
 * originating event instance (when one was given).
 */
export interface RecordedBroadcast {
  channels: string[];
  event: string;
  payload: Record<string, any>;
  source: any;
}

/**
 * A channel matcher: a name, a Channel instance, or a list of either.
 */
type ChannelMatcher = string | Channel | Array<string | Channel>;

export class BroadcastFake {
  /**
   * Every broadcast recorded by this fake, in order
   */
  public readonly broadcasts: RecordedBroadcast[] = [];

  /**
   * The channel authorizer the fake verifies subscriptions with
   */
  public readonly authorizer: ChannelAuthorizer = new ChannelAuthorizer();

  /**
   * Broadcast a normalised event to channels, recording it.
   * Laravel: Broadcast::broadcast() against the fake
   */
  async broadcast(
    channels: string | Channel | Array<string | Channel>,
    event: string,
    payload: BroadcastPayload = {},
    _connection?: string
  ): Promise<void> {
    this.broadcasts.push({
      channels: channelNames(channels),
      event,
      payload,
      source: undefined,
    });
  }

  /**
   * Broadcast a `ShouldBroadcast`-style event synchronously, normalising it
   * through the same path the real manager uses (DRY).
   * Laravel: BroadcastManager::broadcastEvent() against the fake
   */
  async broadcastEvent(event: any, _connection?: string): Promise<void> {
    const normalized = normalizeBroadcastEvent(event);

    if (normalized.channels.length === 0) {
      return;
    }

    this.broadcasts.push({
      channels: normalized.channels.map((channel) => channel.toString()),
      event: normalized.event,
      payload: normalized.payload,
      source: event,
    });
  }

  /**
   * "Queue" a broadcastable event: the fake records it immediately (there is no
   * worker to wait on), honouring `broadcastWhen()` and empty-channel skips.
   * Laravel: BroadcastManager::queue($event) against the fake
   */
  async queue(event: any): Promise<void> {
    if (!isShouldBroadcast(event)) {
      return;
    }

    if (typeof event.broadcastWhen === 'function' && !(await event.broadcastWhen())) {
      return;
    }

    await this.broadcastEvent(event);
  }

  // ==================== Authorization ====================

  /**
   * Register a channel authorization callback.
   * Laravel: Broadcast::channel($pattern, $callback)
   */
  channel(pattern: string, callback: ChannelAuthorizationCallback): this {
    this.authorizer.channel(pattern, callback);

    return this;
  }

  /**
   * Register a presence-channel callback.
   * Laravel: Broadcast::presence($pattern, $callback)
   */
  presence(pattern: string, callback: ChannelAuthorizationCallback): this {
    this.authorizer.presence(pattern, callback);

    return this;
  }

  /**
   * Authenticate a subscription request through the shared authorizer.
   * Laravel: Broadcast::auth($request) against the fake
   */
  async auth(request: BroadcastAuthRequest): Promise<any> {
    const authorization = await this.authorizer.authenticate(request);

    return { auth: `fake:${request.socketId ?? ''}:${request.channelName}`, result: authorization.result };
  }

  // ==================== Assertions ====================

  /**
   * Assert an event was broadcast, optionally matching the payload/source.
   * Laravel: Broadcast::assertBroadcast($event, $callback)
   */
  assertBroadcast(
    matcher: string | (new (...args: any[]) => any) | ((record: RecordedBroadcast) => boolean),
    callback?: (record: RecordedBroadcast) => boolean
  ): void {
    const matching = this.matching(matcher);

    if (matching.length === 0) {
      throw new Error(`No broadcast [${describeMatcher(matcher)}] was made.\nBroadcast: ${this.describe()}`);
    }

    if (callback && !matching.some(callback)) {
      throw new Error(`Broadcast [${describeMatcher(matcher)}] was made but none matched the provided callback.`);
    }
  }

  /**
   * Assert an event was broadcast on the given channel(s).
   * Laravel: Broadcast::assertBroadcastOn($channels, $event)
   */
  assertBroadcastOn(
    channels: ChannelMatcher,
    matcher: string | (new (...args: any[]) => any),
    callback?: (record: RecordedBroadcast) => boolean
  ): void {
    const wanted = channelNames(channels);

    const matching = this.broadcasts.filter(
      (record) =>
        wanted.every((channel) => record.channels.includes(channel)) &&
        recordMatches(record, matcher) &&
        (callback === undefined || callback(record))
    );

    if (matching.length === 0) {
      throw new Error(
        `No broadcast [${describeMatcher(matcher)}] was made on channels [${wanted.join(', ')}].\n` +
          `Broadcast: ${this.describe()}`
      );
    }
  }

  /**
   * Assert no matching broadcast was made.
   * Laravel: Broadcast::assertNotBroadcast($event, $callback)
   */
  assertNotBroadcast(
    matcher: string | (new (...args: any[]) => any),
    callback?: (record: RecordedBroadcast) => boolean
  ): void {
    const matching = this.matching(matcher).filter((record) => callback === undefined || callback(record));

    if (matching.length > 0) {
      throw new Error(`Broadcast [${describeMatcher(matcher)}] was unexpectedly made ${matching.length} time(s).`);
    }
  }

  /**
   * Assert an event was broadcast exactly this many times.
   * Laravel: Broadcast::assertBroadcastTimes($event, $times)
   */
  assertBroadcastTimes(matcher: string | (new (...args: any[]) => any), times: number): void {
    const count = this.matching(matcher).length;

    if (count !== times) {
      throw new Error(`Expected [${describeMatcher(matcher)}] to broadcast ${times} time(s), but it was ${count}.`);
    }
  }

  /**
   * Assert nothing was broadcast at all.
   * Laravel: Broadcast::assertNothingBroadcast()
   */
  assertNothingBroadcast(): void {
    if (this.broadcasts.length > 0) {
      throw new Error(
        `Expected no broadcasts, but ${this.broadcasts.length} were made.\nBroadcast: ${this.describe()}`
      );
    }
  }

  /**
   * The recorded broadcasts, optionally filtered by an event matcher.
   */
  broadcasted(matcher?: string | (new (...args: any[]) => any)): RecordedBroadcast[] {
    return matcher === undefined ? [...this.broadcasts] : this.matching(matcher);
  }

  /**
   * Forget every recorded broadcast.
   */
  reset(): void {
    this.broadcasts.length = 0;
  }

  protected matching(
    matcher: string | (new (...args: any[]) => any) | ((record: RecordedBroadcast) => boolean)
  ): RecordedBroadcast[] {
    if (typeof matcher === 'function' && matcher.prototype === undefined) {
      return this.broadcasts.filter(matcher as (record: RecordedBroadcast) => boolean);
    }

    return this.broadcasts.filter((record) => recordMatches(record, matcher as string | (new (...args: any[]) => any)));
  }

  protected describe(): string {
    if (this.broadcasts.length === 0) {
      return 'none';
    }

    return this.broadcasts.map((record) => `${record.event} -> [${record.channels.join(', ')}]`).join('; ');
  }
}

/**
 * Whether a recorded broadcast matches an event name or class. Matches against
 * both the wire event name (broadcastAs()/class name) and the source class.
 */
function recordMatches(record: RecordedBroadcast, matcher: string | (new (...args: any[]) => any)): boolean {
  const name = typeof matcher === 'string' ? matcher : matcher.name;

  return record.event === name || record.source?.constructor?.name === name;
}

function channelNames(channels: ChannelMatcher): string[] {
  const list = Array.isArray(channels) ? channels : [channels];

  return list.map((channel) => (typeof channel === 'string' ? channel : channel.toString()));
}

function describeMatcher(matcher: unknown): string {
  if (typeof matcher === 'string') {
    return matcher;
  }

  if (typeof matcher === 'function') {
    return matcher.name || '<callback>';
  }

  return String(matcher);
}
