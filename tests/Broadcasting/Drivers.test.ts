/**
 * Broadcast drivers: log / null / pusher
 *
 * The `log` driver records the broadcast, the `null` driver discards it, and
 * the `pusher` driver signs and POSTs a pusher-compatible trigger over the
 * injected HTTP client (mocked here, no SDK).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PusherHttpLike, PusherResponseLike } from '@/Broadcasting/Broadcasters/PusherBroadcaster';
import { LogBroadcaster } from '@/Broadcasting/Broadcasters/LogBroadcaster';
import { NullBroadcaster } from '@/Broadcasting/Broadcasters/NullBroadcaster';
import { PusherBroadcaster } from '@/Broadcasting/Broadcasters/PusherBroadcaster';
import { BroadcastException } from '@/Broadcasting/BroadcastException';
import { BroadcastManager } from '@/Broadcasting/BroadcastManager';
import { BroadcastServiceProvider } from '@/Broadcasting/BroadcastServiceProvider';
import { Channel, PrivateChannel, PresenceChannel } from '@/Broadcasting/Channels';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { broadcast } from '@/Support/helpers';
import type { BroadcastTestApp } from './support';
import { createBroadcastApp } from './support';

/** A recording BroadcastLogger replacement. */
function recorder(): { logger: { lines: string[]; info(message: unknown): void } } {
  const lines: string[] = [];

  return { logger: { lines, info: (message: unknown) => void lines.push(String(message)) } };
}

describe('LogBroadcaster', () => {
  it('records the broadcast with its channels, event and payload', () => {
    const { logger } = recorder();
    const broadcaster = new LogBroadcaster({ logger });

    broadcaster.broadcast([new Channel('orders.1'), new PrivateChannel('users.7')], 'OrderShipped', { id: 1 });

    expect(broadcaster.messages).toHaveLength(1);
    expect(broadcaster.messages[0]).toEqual({
      channels: ['orders.1', 'private-users.7'],
      event: 'OrderShipped',
      payload: { id: 1 },
    });

    // The formatted line also reached the logger.
    expect(logger.lines[0]).toContain('Broadcasting [OrderShipped] on channels [orders.1, private-users.7]');
  });
});

describe('NullBroadcaster', () => {
  it('discards the broadcast', () => {
    const broadcaster = new NullBroadcaster();

    expect(broadcaster.broadcast([new Channel('orders.1')], 'OrderShipped', { id: 1 })).toBeUndefined();
  });
});

describe('PusherBroadcaster', () => {
  interface RecordedRequest {
    url: string;
    data: any;
    headers: Record<string, any>;
  }

  function stubHttp(response: Partial<PusherResponseLike> = {}): { http: PusherHttpLike; requests: RecordedRequest[] } {
    const requests: RecordedRequest[] = [];

    const http: PusherHttpLike = {
      withHeaders(headers: Record<string, string>) {
        return {
          async post(url: string, data: any): Promise<PusherResponseLike> {
            requests.push({ url, data, headers });

            return {
              status: () => response.status?.() ?? 200,
              successful: () => response.successful?.() ?? true,
              body: () => response.body?.() ?? '{}',
            };
          },
        };
      },
    };

    return { http, requests };
  }

  const config = { key: 'APINessKEY', secret: 'super-secret', appId: '42', host: 'api.pusher.test' };

  it('POSTs a signed trigger to the pusher events endpoint', async () => {
    const { http, requests } = stubHttp();
    const broadcaster = new PusherBroadcaster(http, config);

    await broadcaster.broadcast([new Channel('orders.1'), new PrivateChannel('users.7')], 'OrderShipped', { id: 1 });

    expect(requests).toHaveLength(1);
    const [request] = requests;

    expect(request.url).toBe('https://api.pusher.test/apps/42/events');
    expect(request.headers['X-Pusher-Key']).toBe('APINessKEY');
    expect(request.headers['X-Pusher-Signature']).toBeTruthy();

    // The event data is JSON-encoded, the channels are the on-the-wire names,
    // and no socket id is sent unless the payload carried one.
    expect(request.data.name).toBe('OrderShipped');
    expect(JSON.parse(request.data.data)).toEqual({ id: 1 });
    expect(request.data.channels).toEqual(['orders.1', 'private-users.7']);
    expect(request.data.socket_id).toBeUndefined();
  });

  it('passes a socket id through when the payload excludes one', async () => {
    const { http, requests } = stubHttp();
    const broadcaster = new PusherBroadcaster(http, config);

    await broadcaster.broadcast([new Channel('orders.1')], 'OrderShipped', { id: 1, socket: '1.2' });

    expect(requests[0].data.socket_id).toBe('1.2');
    expect(JSON.parse(requests[0].data.data)).toEqual({ id: 1 });
  });

  it('wraps a failed response in a BroadcastException', async () => {
    const { http } = stubHttp({ successful: () => false, status: () => 400, body: () => '{"error":"bad key"}' });
    const broadcaster = new PusherBroadcaster(http, config);

    await expect(broadcaster.broadcast([new Channel('orders.1')], 'OrderShipped', {})).rejects.toThrow(
      BroadcastException
    );
  });

  it('signs a private-channel auth response', () => {
    const { http } = stubHttp();
    const broadcaster = new PusherBroadcaster(http, config);

    const response = broadcaster.validAuthenticationResponse(
      { channelName: 'private-orders.1', socketId: '1234.5678' },
      true
    );

    // Pusher's auth string is `key:socket_id:signature` (hex HMAC-SHA256).
    expect(response.auth).toMatch(/^APINessKEY:1234\.5678:[0-9a-f]{64}$/);
    expect(response.channel_data).toBeUndefined();
  });

  it('signs a presence-channel auth response with channel data', () => {
    const { http } = stubHttp();
    const broadcaster = new PusherBroadcaster(http, config);

    const response = broadcaster.validAuthenticationResponse(
      { channelName: 'presence-room.1', socketId: '1234.5678' },
      { user_id: '5', user_info: { name: 'Ada' } }
    );

    expect(response.auth).toMatch(/^APINessKEY:1234\.5678:[0-9a-f]{64}$/);
    expect(JSON.parse(response.channel_data)).toEqual({ user_id: '5', user_info: { name: 'Ada' } });
  });
});

describe('BroadcastManager drivers', () => {
  let test: BroadcastTestApp;

  beforeEach(async () => {
    test = await createBroadcastApp();
  });

  afterEach(async () => {
    await test.cleanup();
  });

  it('registers the manager under the broadcast container key', () => {
    expect(test.app.make('broadcast')).toBeInstanceOf(BroadcastManager);
    expect(broadcast()).toBe(test.manager);
  });

  it('resolves the log, null and pusher connections', () => {
    expect(test.manager.getDefaultDriver()).toBe('log');
    expect(test.manager.connection()).toBeInstanceOf(LogBroadcaster);
    expect(test.manager.connection('null')).toBeInstanceOf(NullBroadcaster);
  });

  it('selects a pusher connection from config', () => {
    const app = new Application(test.base);
    app.instance(
      'config',
      new Config({
        broadcasting: {
          default: 'pusher',
          connections: { pusher: { driver: 'pusher', key: 'k', secret: 's', app_id: 'a' } },
        },
      })
    );
    app.register(BroadcastServiceProvider);

    const manager = app.make<BroadcastManager>('broadcast');

    expect(manager.connection()).toBeInstanceOf(PusherBroadcaster);
  });

  it('builds a custom driver through extend()', async () => {
    const seen: string[] = [];

    // A custom driver is selected through a connection that names it (Laravel's
    // `broadcasting.connections.*.driver`), so register both.
    test.manager.config.connections.spy = { driver: 'spy' };
    test.manager.extend('spy', () => ({
      auth: async () => true,
      validAuthenticationResponse: () => ({}),
      broadcast: (channels: Channel[]) => void seen.push(channels.map((c) => c.toString()).join(',')),
    }));

    await test.manager.broadcast('orders.1', 'OrderShipped', { id: 1 }, 'spy');

    expect(seen).toEqual(['orders.1']);
  });

  it('rejects an unknown connection', () => {
    expect(() => test.manager.connection('nope')).toThrow(/Broadcast connection \[nope\] is not defined/);
  });
});

describe('Channel value objects', () => {
  it('prefixes private and presence channels and renders wire names', () => {
    expect(new Channel('orders.1').toString()).toBe('orders.1');
    expect(new PrivateChannel('orders.1').toString()).toBe('private-orders.1');
    expect(new PresenceChannel('room.1').toString()).toBe('presence-room.1');

    // Idempotent: re-wrapping a prefixed name does not double the prefix.
    expect(new PrivateChannel('private-orders.1').toString()).toBe('private-orders.1');
  });

  it('serialises to the Laravel toArray shape', () => {
    expect(new Channel('orders.1').toArray()).toEqual({ channel: 'orders.1' });
    expect(new PrivateChannel('orders.1').toArray()).toEqual({ privateChannel: 'private-orders.1' });
    expect(new PresenceChannel('room.1').toArray()).toEqual({ presenceChannel: 'presence-room.1' });
  });
});
