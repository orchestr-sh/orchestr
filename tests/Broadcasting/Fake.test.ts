/**
 * Broadcast::fake() and the auth endpoint
 *
 * The fake records every broadcast instead of delivering it and answers the
 * Laravel assertions (assertBroadcast, assertBroadcastOn, assertNotBroadcast,
 * assertBroadcastTimes, assertNothingBroadcast). The BroadcastController
 * turns an authenticated channel-authorization POST into the driver's auth
 * response (403 on denial, 422 on a missing channel).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { BroadcastFake } from '@/Support/Testing/Fakes/BroadcastFake';
import { AuthorizationException } from '@/Auth/Access/AuthorizationException';
import { BroadcastController } from '@/Broadcasting/BroadcastController';
import { Channel, PrivateChannel } from '@/Broadcasting/Channels';
import { Event } from '@/Events/Event';
import { Broadcast } from '@/Facades/Broadcast';
import { broadcast, setGlobalApp } from '@/Support/helpers';
import type { BroadcastTestApp } from './support';
import { createBroadcastApp } from './support';

class OrderShipped extends Event {
  constructor(public readonly orderId: number) {
    super();
  }

  broadcastOn(): Channel[] {
    return [new Channel(`orders.${this.orderId}`), new PrivateChannel(`users.${this.orderId}`)];
  }
}

class OrderCancelled extends Event {
  broadcastOn(): string {
    return 'orders.cancelled';
  }
}

describe('Broadcast::fake()', () => {
  let test: BroadcastTestApp;
  let fake: BroadcastFake;

  beforeEach(async () => {
    test = await createBroadcastApp();
    fake = Broadcast.fake();
  });

  afterEach(async () => {
    Broadcast.fakeInstance();
    await test.cleanup();
  });

  it('routes the manager and dispatcher to the fake', async () => {
    expect(broadcast()).toBe(fake as unknown as ReturnType<typeof broadcast>);

    await test.app.make<any>('events').dispatch(new OrderShipped(1));

    fake.assertBroadcast(OrderShipped);
    fake.assertBroadcastOn(['orders.1', 'private-users.1'], OrderShipped);
  });

  it('records explicit broadcasts and asserts not-broadcast', async () => {
    await fake.broadcast('orders.5', 'OrderShipped', { id: 5 });

    fake.assertBroadcast('OrderShipped');
    fake.assertBroadcastOn('orders.5', 'OrderShipped');
    fake.assertNotBroadcast(OrderCancelled);
    fake.assertBroadcastTimes(OrderShipped, 1);
  });

  it('assertNothingBroadcast passes when nothing was sent', () => {
    fake.assertNothingBroadcast();
  });

  it('throws when an assertion is not satisfied', () => {
    expect(() => fake.assertBroadcast(OrderShipped)).toThrow(/was not made|No broadcast/);
  });

  it('honours broadcastWhen() on the fake queue path', async () => {
    class Conditional extends Event {
      broadcastOn(): string {
        return 'conditional';
      }

      broadcastWhen(): boolean {
        return false;
      }
    }

    await fake.queue(new Conditional());

    fake.assertNothingBroadcast();
  });
});

describe('BroadcastController', () => {
  let test: BroadcastTestApp;

  beforeEach(async () => {
    test = await createBroadcastApp();
  });

  afterEach(async () => {
    await test.cleanup();
  });

  function fakeRequest(body: Record<string, any>, user: any): any {
    return {
      input: (key: string) => body[key],
      user: async () => user,
    };
  }

  it('returns the driver auth response for an authorized channel', async () => {
    test.manager.channel('orders.{id}', (u: any, id: string) => String(u.id) === id);

    const controller = new BroadcastController();
    const response = await controller.authenticate(
      fakeRequest({ channel_name: 'private-orders.7', socket_id: '1.2' }, { id: 7 })
    );

    expect(response.data).toEqual({});
  });

  it('answers 422 when the channel name is missing', async () => {
    setGlobalApp(test.app);

    const controller = new BroadcastController();
    const response = await controller.authenticate(fakeRequest({ socket_id: '1.2' }, { id: 1 }));

    expect(response.status).toBe(422);
  });

  it('rejects a denied channel authorization', async () => {
    test.manager.channel('orders.{id}', () => false);
    setGlobalApp(test.app);

    const controller = new BroadcastController();

    await expect(
      controller.authenticate(fakeRequest({ channel_name: 'private-orders.7', socket_id: '1.2' }, { id: 1 }))
    ).rejects.toBeInstanceOf(AuthorizationException);
  });
});
