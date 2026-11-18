/**
 * Event broadcasting through the dispatcher
 *
 * An event implementing ShouldBroadcast is broadcast to the channels from
 * broadcastOn(); broadcastWith()/broadcastAs() shape the payload and event
 * name; broadcastWhen() gates it; ShouldBroadcastNow delivers synchronously;
 * broadcastQueue() pushes the broadcast through the queue subsystem.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ShouldBroadcast, ShouldBroadcastNow } from '@/Broadcasting/Contracts/ShouldBroadcast';
import { BroadcastEvent } from '@/Broadcasting/BroadcastEvent';
import { Channel, PrivateChannel, PresenceChannel } from '@/Broadcasting/Channels';
import { normalizeBroadcastEvent } from '@/Broadcasting/Concerns/NormalizesBroadcastEvent';
import { Event } from '@/Events/Event';
import { Job } from '@/Queue/Job';
import type { BroadcastTestApp } from './support';
import { createBroadcastApp } from './support';

class OrderShipped extends Event implements ShouldBroadcast {
  constructor(
    public readonly orderId: number,
    public readonly carrier: string
  ) {
    super();
  }

  broadcastOn(): Channel[] {
    return [new Channel(`orders.${this.orderId}`), new PrivateChannel(`users.${this.orderId}`)];
  }
}

/** broadcastAs/broadcastWith customise the wire name and payload */
class InvoicePaid extends Event implements ShouldBroadcast {
  constructor(
    public readonly invoiceId: number,
    public readonly internalSecret: string
  ) {
    super();
  }

  broadcastOn(): string {
    return `invoices.${this.invoiceId}`;
  }

  broadcastAs(): string {
    return 'invoice.paid';
  }

  broadcastWith(): Record<string, any> {
    return { id: this.invoiceId };
  }
}

/** broadcastWhen vetoes the broadcast */
class Conditional extends Event implements ShouldBroadcast {
  constructor(
    public readonly enabled: boolean,
    public readonly channel = 'conditional'
  ) {
    super();
  }

  broadcastOn(): string {
    return this.channel;
  }

  broadcastWhen(): boolean {
    return this.enabled;
  }
}

/** Delivered synchronously, never through the queue */
class PingNow extends Event implements ShouldBroadcastNow {
  readonly broadcastNow = true;

  broadcastOn(): string {
    return 'pings';
  }
}

/** Queued on a named queue */
class QueuedBroadcast extends Event implements ShouldBroadcast {
  broadcastOn(): string {
    return 'queued';
  }

  broadcastQueue(): string {
    return 'broadcasts';
  }
}

describe('normalizeBroadcastEvent', () => {
  it('defaults the event name to the class and the payload to public props', () => {
    const normalized = normalizeBroadcastEvent(new OrderShipped(7, 'DHL'));

    expect(normalized.event).toBe('OrderShipped');
    expect(normalized.channels.map((c) => c.toString())).toEqual(['orders.7', 'private-users.7']);
    expect(normalized.payload).toEqual({ orderId: 7, carrier: 'DHL' });
  });

  it('honours broadcastAs()/broadcastWith()', () => {
    const normalized = normalizeBroadcastEvent(new InvoicePaid(3, 'shhh'));

    expect(normalized.event).toBe('invoice.paid');
    expect(normalized.payload).toEqual({ id: 3 });
    expect(normalized.payload.internalSecret).toBeUndefined();
  });
});

describe('Dispatcher broadcasting', () => {
  let test: BroadcastTestApp;

  beforeEach(async () => {
    test = await createBroadcastApp();
  });

  afterEach(async () => {
    await test.cleanup();
  });

  it('broadcasts a ShouldBroadcast event to its channels via the default driver', async () => {
    const spy = vi.fn();
    test.manager.extend('log', () => ({
      auth: async () => true,
      validAuthenticationResponse: () => ({}),
      broadcast: spy,
    }));
    test.manager.disconnect('log');

    await test.app.make<any>('events').dispatch(new OrderShipped(11, 'UPS'));

    expect(spy).toHaveBeenCalledTimes(1);
    const [channels, event, payload] = spy.mock.calls[0];
    expect(channels.map((c: Channel) => c.toString())).toEqual(['orders.11', 'private-users.11']);
    expect(event).toBe('OrderShipped');
    expect(payload).toEqual({ orderId: 11, carrier: 'UPS' });
  });

  it('applies broadcastAs()/broadcastWith() to what is sent', async () => {
    const spy = vi.fn();
    test.manager.extend('log', () => ({
      auth: async () => true,
      validAuthenticationResponse: () => ({}),
      broadcast: spy,
    }));
    test.manager.disconnect('log');

    await test.app.make<any>('events').dispatch(new InvoicePaid(9, 'secret'));

    expect(spy.mock.calls[0][1]).toBe('invoice.paid');
    expect(spy.mock.calls[0][2]).toEqual({ id: 9 });
  });

  it('skips the broadcast when broadcastWhen() is false', async () => {
    const spy = vi.fn();
    test.manager.extend('log', () => ({
      auth: async () => true,
      validAuthenticationResponse: () => ({}),
      broadcast: spy,
    }));
    test.manager.disconnect('log');

    await test.app.make<any>('events').dispatch(new Conditional(false));

    expect(spy).not.toHaveBeenCalled();

    await test.app.make<any>('events').dispatch(new Conditional(true));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('delivers a ShouldBroadcastNow event synchronously', async () => {
    const spy = vi.fn();
    test.manager.extend('log', () => ({
      auth: async () => true,
      validAuthenticationResponse: () => ({}),
      broadcast: spy,
    }));
    test.manager.disconnect('log');

    await test.app.make<any>('events').dispatch(new PingNow());

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0][0].toString()).toBe('pings');
  });

  it('pushes a broadcastQueue event through the queue subsystem', async () => {
    const pushed: Job[] = [];
    const queue = test.app.make<any>('queue');
    const original = queue.push.bind(queue);
    queue.push = (job: Job, q?: string) => {
      pushed.push(job);

      return original(job, q);
    };

    // A null default connection keeps the sync delivery quiet; the assertion
    // is on the *push*, proving the broadcast went through the queue subsystem.
    test.manager.setDefaultDriver('null');

    await test.app.make<any>('events').dispatch(new QueuedBroadcast());

    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toBeInstanceOf(BroadcastEvent);
    expect((pushed[0] as BroadcastEvent).queue).toBe('broadcasts');
    expect((pushed[0] as BroadcastEvent).event).toBeInstanceOf(QueuedBroadcast);
  });

  it('never fails a dispatch when broadcasting throws', async () => {
    test.manager.extend('log', () => ({
      auth: async () => true,
      validAuthenticationResponse: () => ({}),
      broadcast: () => {
        throw new Error('driver down');
      },
    }));
    test.manager.disconnect('log');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const responses = await test.app.make<any>('events').dispatch(new OrderShipped(1, 'X'));

    expect(responses).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('does not attempt to broadcast a plain event', async () => {
    const spy = vi.fn();
    test.manager.extend('log', () => ({
      auth: async () => true,
      validAuthenticationResponse: () => ({}),
      broadcast: spy,
    }));
    test.manager.disconnect('log');

    class Plain extends Event {}

    await test.app.make<any>('events').dispatch(new Plain());

    expect(spy).not.toHaveBeenCalled();
  });
});
