/**
 * Channel Authorizer
 *
 * The channel-authorization half of the broadcasting layer, kept apart from
 * the drivers that deliver events (SRP: broadcasters deliver, this decides who
 * may listen). Mirrors the channel-handling logic Laravel bundles into
 * Illuminate\Broadcasting\Broadcasters\Broadcaster: register callbacks under
 * `{param}`-style patterns, match an incoming channel name, extract its
 * parameters, and run the callback with the authenticated user.
 *
 * `Broadcast.channel('orders.{id}', callback)` registers a pattern; a private
 * channel's `private-` prefix (or a presence channel's `presence-` prefix) is
 * stripped before matching, so the callback names the bare channel.
 */

import type { BroadcastAuthRequest } from '@/Broadcasting/Contracts/Broadcaster';
import { AuthorizationException } from '@/Auth/Access/AuthorizationException';
import { channelPrefix, normalizeChannelName } from '@/Broadcasting/Channels';

/**
 * A channel authorization callback: receives the authenticated user (null for
 * guests) followed by the parameters extracted from the channel name. Returns
 * truthy to allow the subscription, or presence-channel data.
 */
export type ChannelAuthorizationCallback = (user: any, ...params: string[]) => any;

interface RegisteredChannel {
  pattern: string;
  callback: ChannelAuthorizationCallback;
}

/**
 * The result of authorizing a channel subscription.
 */
export interface ChannelAuthorization {
  /** The callback's return value (presence data / arbitrary truthy result) */
  result: any;

  /** The channel name as requested, including its auth prefix */
  channelName: string;

  /** Whether the channel is a presence channel */
  presence: boolean;

  /** Whether the channel is guarded (private/presence) */
  guarded: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a `{param}`-style channel pattern into a RegExp plus its parameter
 * names. `.` is a literal separator and `{name}` captures one segment, exactly
 * like Laravel's extractChannelKeys/channelNameMatchesPattern.
 */
function compilePattern(pattern: string): { regex: RegExp; names: string[] } {
  const names: string[] = [];
  let source = '';

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];

    if (char === '{') {
      const end = pattern.indexOf('}', i);

      if (end === -1) {
        source += escapeRegExp(char);
        continue;
      }

      names.push(pattern.slice(i + 1, end));
      source += '([^\\.]+)';
      i = end;
      continue;
    }

    if (char === '*') {
      names.push('*');
      source += '.*';
      continue;
    }

    source += escapeRegExp(char);
  }

  return { regex: new RegExp(`^${source}$`), names };
}

export class ChannelAuthorizer {
  /**
   * Registered channel patterns, in registration order.
   */
  protected channels: RegisteredChannel[] = [];

  /**
   * Register a channel authorization callback.
   * Laravel: Broadcast::channel($pattern, $callback)
   */
  channel(pattern: string, callback: ChannelAuthorizationCallback): this {
    this.channels.push({ pattern, callback });

    return this;
  }

  /**
   * Register a presence-channel callback; the `presence-` prefix is applied so
   * callers can register the bare channel name.
   * Laravel: Broadcast::presence($pattern, $callback)
   */
  presence(pattern: string, callback: ChannelAuthorizationCallback): this {
    const normalized = pattern.startsWith('presence-') ? pattern : `presence-${pattern}`;

    return this.channel(normalized, callback);
  }

  /**
   * Register a public (guest-accessible) channel. Passing no callback allows
   * anyone to subscribe to the matching channels.
   * Laravel: Broadcast::guest($pattern, $callback = null)
   */
  guest(pattern: string, callback?: ChannelAuthorizationCallback): this {
    return this.channel(pattern, callback ?? (() => true));
  }

  /**
   * The registered patterns, for inspection and tests.
   */
  getChannels(): Array<{ pattern: string }> {
    return this.channels.map(({ pattern }) => ({ pattern }));
  }

  /**
   * Determine whether a channel name matches a registered pattern.
   */
  has(channelName: string): boolean {
    return this.match(channelName) !== null;
  }

  /**
   * Find the first pattern matching the (prefix-normalised) channel name.
   */
  protected match(channelName: string): RegisteredChannel | null {
    const target = normalizeChannelName(channelName);

    for (const entry of this.channels) {
      const { regex } = compilePattern(normalizeChannelName(entry.pattern));

      if (regex.test(target)) {
        return entry;
      }
    }

    return null;
  }

  /**
   * Extract the `{param}` values the incoming channel name fills in.
   */
  protected extractParameters(pattern: string, channelName: string): string[] {
    const { regex, names } = compilePattern(normalizeChannelName(pattern));
    const matched = normalizeChannelName(channelName).match(regex);

    if (!matched) {
      return [];
    }

    return names.slice(0, matched.length - 1).map((_name, index) => matched[index + 1]);
  }

  /**
   * Authenticate a subscription request against the registered callbacks.
   *
   * A guarded (private/presence) channel with no authenticated user, or a
   * callback that returns false, raises `AuthorizationException`; a callback
   * that returns truthy data is reported back for the driver to shape into its
   * auth response. Public channels with no registered callback are allowed.
   *
   * Laravel: Broadcaster::verifyUserCanAccessChannel()
   */
  async authenticate(request: BroadcastAuthRequest): Promise<ChannelAuthorization> {
    const { channelName, user } = request;
    const prefix = channelPrefix(channelName);
    const guarded = prefix !== null;
    const entry = this.match(channelName);

    if (guarded && !user) {
      throw new AuthorizationException('You are not authorized to access this channel.');
    }

    if (!entry) {
      if (guarded) {
        throw new AuthorizationException('You are not authorized to access this channel.');
      }

      return { result: true, channelName, presence: false, guarded };
    }

    const params = this.extractParameters(entry.pattern, channelName);
    const result = await entry.callback(user ?? null, ...params);

    if (result === false || result === null || result === undefined) {
      throw new AuthorizationException('You are not authorized to access this channel.');
    }

    return {
      result,
      channelName,
      presence: prefix === 'presence-',
      guarded,
    };
  }
}
