/**
 * PusherBroadcaster - delivers broadcasts over Pusher's HTTP trigger API.
 *
 * Mirrors Illuminate\Broadcasting\Broadcasters\PusherBroadcaster, but talks to
 * the pusher-compatible HTTP endpoint directly through Orchestr's own HTTP
 * client instead of pulling in the `pusher` SDK - a plain signed POST is all
 * triggering an event needs, so no optional dependency is required. The
 * client is injected (OCP/test seam): the manager hands it the container's
 * `http` factory, and tests hand it a recording stub or run behind
 * `Http.fake()`.
 *
 * It also owns the driver-specific authentication shapes Pusher clients
 * expect: the signed `auth` string for private channels and the
 * `auth` + `channel_data` pair for presence channels (HMAC-SHA256 over the
 * socket id, channel name, and - for presence - the channel data).
 */

import { createHmac } from 'crypto';
import type { ChannelAuthorization, ChannelAuthorizer } from '@/Broadcasting/ChannelAuthorizer';
import type { Channel } from '@/Broadcasting/Channels';
import type { BroadcastPayload, BroadcastAuthRequest } from '@/Broadcasting/Contracts/Broadcaster';
import { AbstractBroadcaster } from '@/Broadcasting/Broadcasters/Broadcaster';
import { BroadcastException } from '@/Broadcasting/BroadcastException';

/**
 * The HTTP surface the broadcaster needs from the client factory: it builds a
 * JSON POST and reports status/body. Orchestr's Http factory satisfies it; a
 * stub does too.
 */
export interface PusherHttpLike {
  withHeaders(headers: Record<string, string>): {
    post(url: string, data: any): Promise<PusherResponseLike>;
  };
}

/**
 * The minimal response shape read after a trigger call.
 */
export interface PusherResponseLike {
  status(): number;
  successful(): boolean;
  body(): string;
}

export interface PusherBroadcasterConfig {
  /** Pusher application key */
  key?: string;

  /** Pusher application secret, used to sign triggers and channel auth */
  secret?: string;

  /** Pusher application id */
  appId?: string;

  /** API host; defaults to the mt1 cluster host */
  host?: string;

  /** Request scheme (`https` by default) */
  scheme?: string;

  /**
   * When a channel is guarded, presence-channel user data is serialised with
   * this identifier. Kept for parity with Laravel's broadcasting identifier.
   */
  [key: string]: any;
}

const DEFAULT_HOST = 'api-mt1.pusher.com';

export class PusherBroadcaster extends AbstractBroadcaster {
  constructor(
    protected http: PusherHttpLike,
    protected config: PusherBroadcasterConfig = {},
    authorizer?: ChannelAuthorizer
  ) {
    super(authorizer);
  }

  /**
   * Authenticate a channel subscription and return the Pusher-shaped response.
   * The base verifies access (throwing on denial); the result is then shaped
   * into the `auth`/`channel_data` a Pusher client needs.
   */
  override async auth(request: BroadcastAuthRequest): Promise<any> {
    const authorization: ChannelAuthorization = await super.auth(request);

    return await this.validAuthenticationResponse(request, authorization.result);
  }

  /**
   * Build the Pusher authentication response.
   *
   * Private:  { auth: "key:socketId:HMAC(socketId:channel)" }
   * Presence: { auth: "key:socketId:HMAC(socketId:channel:data)", channel_data }
   *
   * Laravel: PusherBroadcaster::validAuthenticationResponse()
   */
  override validAuthenticationResponse(request: BroadcastAuthRequest, result: any): any {
    const socketId = request.socketId ?? '';
    const channelName = request.channelName;
    const key = this.config.key ?? '';
    const secret = this.config.secret ?? '';

    if (!channelName.startsWith('presence-')) {
      const signature = sign(`${socketId}:${channelName}`, secret);

      return { auth: `${key}:${socketId}:${signature}` };
    }

    const { userId, userInfo } = presenceUser(result, request.user);
    const channelData = JSON.stringify({ user_id: userId, user_info: userInfo });
    const signature = sign(`${socketId}:${channelName}:${channelData}`, secret);

    return {
      auth: `${key}:${socketId}:${signature}`,
      channel_data: channelData,
    };
  }

  /**
   * Trigger the event on Pusher's REST endpoint, batching at most 100 channels
   * per request like the SDK does.
   *
   * Laravel: PusherBroadcaster::broadcast()
   */
  override async broadcast(channels: Channel[], event: string, payload: BroadcastPayload = {}): Promise<void> {
    const { socket, ...data } = payload ?? {};

    const body = {
      name: event,
      data: JSON.stringify(data),
      ...(socket !== undefined ? { socket_id: socket } : {}),
    };

    for (const batch of chunk(
      channels.map((channel) => channel.toString()),
      100
    )) {
      await this.trigger({ ...body, channels: batch });
    }
  }

  /**
   * One signed POST to `/apps/{appId}/events`.
   */
  protected async trigger(body: Record<string, any>): Promise<void> {
    const host = this.config.host ?? DEFAULT_HOST;
    const scheme = this.config.scheme ?? 'https';
    const path = `/apps/${this.config.appId ?? ''}/events`;
    const url = `${scheme}://${host}${path}`;
    const encoded = JSON.stringify(body);
    const date = new Date().toUTCString();

    const signature = base64Hmac(`${methodPathBody('POST', host, path, encoded)}`, this.config.secret ?? '');

    const response = await this.http
      .withHeaders({
        'Content-Type': 'application/json',
        'X-Pusher-Key': this.config.key ?? '',
        'X-Pusher-Secret': this.config.secret ?? '',
        'X-Pusher-Date': date,
        'X-Pusher-Signature': signature,
      })
      .post(url, body);

    if (!response.successful()) {
      throw new BroadcastException(`Pusher error: ${describeError(response.status(), response.body())}`);
    }
  }
}

/**
 * HMAC-SHA256, hex-encoded: the string-to-sign scheme Pusher channel auth uses.
 */
function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/**
 * HMAC-SHA256, base64-encoded: the trigger-request signature.
 */
function base64Hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64');
}

/**
 * The canonical string Pusher signs for a REST trigger: METHOD, host, path and
 * body, each on its own line, with a trailing newline.
 */
function methodPathBody(method: string, host: string, path: string, body: string): string {
  return `${method}\n${host}\n${path}\n${body}\n`;
}

/**
 * Pull the presence channel's user id/info out of the callback's result, which
 * may be `{ user_id, user_info }`, a plain user id, or `true` (fall back to the
 * authenticated user's own broadcasting identifier).
 */
function presenceUser(result: any, user: any): { userId: any; userInfo: any } {
  if (result && typeof result === 'object' && ('user_id' in result || 'user_info' in result)) {
    return { userId: result.user_id ?? userIdOf(user), userInfo: result.user_info ?? {} };
  }

  if (result === true || result === null || result === undefined) {
    return { userId: userIdOf(user), userInfo: {} };
  }

  return { userId: userIdOf(user), userInfo: result };
}

function userIdOf(user: any): any {
  if (user && typeof user.getAuthIdentifierForBroadcasting === 'function') {
    return user.getAuthIdentifierForBroadcasting();
  }

  if (user && typeof user.getAuthIdentifier === 'function') {
    return user.getAuthIdentifier();
  }

  return user?.id ?? null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }

  return batches;
}

function describeError(status: number, body: string): string {
  try {
    return JSON.parse(body)?.error ?? `request failed with status ${status}`;
  } catch {
    return `request failed with status ${status}`;
  }
}
