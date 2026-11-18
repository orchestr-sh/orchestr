/**
 * Broadcast channels - the value objects naming where an event goes.
 *
 * Mirrors Illuminate\Broadcasting\Channel / PrivateChannel / PresenceChannel:
 * a channel wraps a name, knows the auth prefix it carries on the wire
 * (`private-`, `presence-`), and renders itself for a driver either as a
 * plain string (drivers send string channel names) or through `toArray()`
 * for JSON payloads. SRP: these are dumb names; the channel *authorization*
 * logic lives in the ChannelAuthorizer, not here.
 */

/**
 * A public channel - anyone may subscribe.
 */
export class Channel {
  public readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * The channel as it appears on the wire (public channels are unprefixed).
   */
  toString(): string {
    return this.name;
  }

  /**
   * The Laravel `toArray()` shape, used when a driver serialises channels.
   */
  toArray(): Record<string, string> {
    return { channel: this.name };
  }
}

/**
 * A private channel - subscribers must be authorised, but the channel does
 * not track *who* is present. Names carry the `private-` prefix.
 */
export class PrivateChannel extends Channel {
  constructor(name: string) {
    super(name.startsWith('private-') ? name : `private-${name}`);
  }

  override toArray(): Record<string, string> {
    return { privateChannel: this.name };
  }
}

/**
 * A presence channel - authorised subscribers, and the channel announces the
 * member list. Names carry the `presence-` prefix.
 */
export class PresenceChannel extends Channel {
  constructor(name: string) {
    super(name.startsWith('presence-') ? name : `presence-${name}`);
  }

  override toArray(): Record<string, string> {
    return { presenceChannel: this.name };
  }

  /**
   * Whether the given channel name refers to a presence channel.
   */
  static isPresence(name: string): boolean {
    return name.startsWith('presence-');
  }
}

/**
 * A channel that is resolved lazily from a callback; kept for API parity with
 * Laravel's AnonymousChannel and future use.
 */
export class AnonymousChannel extends Channel {}

/**
 * Anything a broadcast source may name a channel with: a string or a Channel
 * (or any value carrying its wire name through `toString()`).
 */
export type ChannelLike = string | { toString(): string };

/**
 * Normalise a single channel or a list into `Channel` instances. A bare
 * string becomes a public `Channel`; an already-built channel passes through
 * (DRY: one normalisation path shared by every driver).
 */
export function toChannels(channels: ChannelLike | ChannelLike[]): Channel[] {
  const list = Array.isArray(channels) ? channels : [channels];

  return list.map((channel) => (channel instanceof Channel ? channel : new Channel(String(channel))));
}

/**
 * Render channels to the string names drivers send to their services.
 */
export function formatChannels(channels: ChannelLike | ChannelLike[]): string[] {
  return toChannels(channels).map((channel) => channel.toString());
}

/**
 * The auth prefix a channel name carries, if any (`private-` / `presence-`).
 */
export function channelPrefix(name: string): 'presence-' | 'private-' | null {
  if (name.startsWith('presence-')) {
    return 'presence-';
  }

  if (name.startsWith('private-')) {
    return 'private-';
  }

  return null;
}

/**
 * The channel name with its auth prefix stripped, matching the registered
 * authorization pattern.
 */
export function normalizeChannelName(name: string): string {
  const prefix = channelPrefix(name);

  return prefix ? name.slice(prefix.length) : name;
}
