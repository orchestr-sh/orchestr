/**
 * Channel authorization
 *
 * Private and presence channels are guarded by the callbacks registered with
 * `Broadcast.channel(...)` / `Broadcast.presence(...)`: the authenticated user
 * and the channel's `{param}` values reach the callback, a falsey result (or a
 * guest on a guarded channel) is denied, and the manager answers with the
 * active driver's auth response.
 */

import { describe, it, expect } from 'vitest';
import { AuthorizationException } from '@/Auth/Access/AuthorizationException';
import { BroadcastManager } from '@/Broadcasting/BroadcastManager';

function manager(): BroadcastManager {
  return new BroadcastManager({ default: 'log', connections: { log: { driver: 'log' } } });
}

describe('ChannelAuthorizer', () => {
  it('authorizes a private channel when the callback allows it', async () => {
    const broadcast = manager();
    broadcast.channel('orders.{id}', (user, id) => String(user.id) === id);

    const authorization = await broadcast.auth({
      channelName: 'private-orders.7',
      socketId: '1.2',
      user: { id: 7 },
    });

    // The log driver has no per-client token, so it answers with {}.
    expect(authorization).toEqual({});
  });

  it('extracts every `{param}` and passes the user first', async () => {
    const seen: any[] = [];
    const broadcast = manager();
    broadcast.channel('teams.{team}.channels.{channel}', (user, team, channel) => {
      seen.push({ user, team, channel });

      return true;
    });

    await broadcast.auth({
      channelName: 'private-teams.acme.channels.dev',
      user: { id: 1 },
    });

    expect(seen).toEqual([{ user: { id: 1 }, team: 'acme', channel: 'dev' }]);
  });

  it('denies when the callback returns false', async () => {
    const broadcast = manager();
    broadcast.channel('orders.{id}', () => false);

    await expect(broadcast.auth({ channelName: 'private-orders.1', user: { id: 1 } })).rejects.toBeInstanceOf(
      AuthorizationException
    );
  });

  it('denies a guest on a guarded channel', async () => {
    const broadcast = manager();
    broadcast.channel('orders.{id}', () => true);

    await expect(broadcast.auth({ channelName: 'private-orders.1', user: null })).rejects.toBeInstanceOf(
      AuthorizationException
    );
  });

  it('denies a guarded channel with no registered callback', async () => {
    const broadcast = manager();

    await expect(broadcast.auth({ channelName: 'private-secret', user: { id: 1 } })).rejects.toBeInstanceOf(
      AuthorizationException
    );
  });

  it('allows a public channel that registered a guest callback', async () => {
    const broadcast = manager();
    broadcast.guest('news.*');

    const authorization = await broadcast.auth({ channelName: 'news.top', user: null });

    expect(authorization).toEqual({});
  });

  it('exposes the registered patterns', () => {
    const broadcast = manager();
    broadcast.channel('orders.{id}', () => true);
    broadcast.presence('rooms.{id}', () => ({ user_id: 1 }));

    const patterns = broadcast.channels.getChannels().map((channel) => channel.pattern);

    expect(patterns).toContain('orders.{id}');
    expect(patterns).toContain('presence-rooms.{id}');
  });
});
