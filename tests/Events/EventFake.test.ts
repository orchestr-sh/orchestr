/**
 * EventFake async + queued assertion tests
 *
 * The fake mirrors the async dispatcher contract: dispatch/until resolve to
 * promises, registered listeners never run, and dispatches that the real
 * dispatcher would have routed through the queue (queued registrations,
 * wildcards included) are assertable.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Dispatcher } from '@/Events/Dispatcher';
import { Event } from '@/Events/Event';
import { Event as EventFacade } from '@/Facades/Event';
import { Application } from '@/Foundation/Application';
import { Facade } from '@/Support/Facade';

class OrderPlaced extends Event {
  constructor(public readonly orderId: number) {
    super();
  }
}

class OrderShipped extends Event {
  constructor(public readonly orderId: number) {
    super();
  }
}

const handled: string[] = [];

class NotifySpy {
  async handle(event: OrderPlaced): Promise<void> {
    await Promise.resolve();
    handled.push(`notify:${event.orderId}`);
  }
}

describe('EventFake', () => {
  let app: Application;

  beforeEach(() => {
    handled.length = 0;
    app = new Application('/test');
    app.instance('events', new Dispatcher(app));
    Facade.setFacadeApplication(app);
  });

  afterEach(() => {
    Facade.clearResolvedInstances();
    Facade.setFacadeApplication(undefined as any);
  });

  it('records dispatches without invoking async listeners', async () => {
    const fake = EventFacade.fake();
    fake.listen(OrderPlaced.name, NotifySpy);

    await EventFacade.dispatch(new OrderPlaced(1));

    expect(handled).toEqual([]);
    fake.assertDispatched(OrderPlaced);
    fake.assertDispatchedTimes(OrderPlaced, 1);
  });

  it('until() is promise-aware and resolves to null', async () => {
    EventFacade.fake();

    await expect(EventFacade.until(new OrderPlaced(1))).resolves.toBeNull();
  });

  it('asserts dispatches that would go to the queue', async () => {
    const fake = EventFacade.fake();
    fake.listen(OrderPlaced.name, NotifySpy, true);

    await EventFacade.dispatch(new OrderPlaced(2));

    fake.assertDispatched(OrderPlaced);
    fake.assertDispatchedToQueue(OrderPlaced);
    expect(fake.getQueuedDispatched(OrderPlaced)).toHaveLength(1);
  });

  it('does not mark dispatches queued without queued listeners', async () => {
    const fake = EventFacade.fake();
    fake.listen(OrderPlaced.name, NotifySpy);

    await EventFacade.dispatch(new OrderPlaced(3));

    fake.assertDispatched(OrderPlaced);
    expect(() => fake.assertDispatchedToQueue(OrderPlaced)).toThrow(/was not dispatched to the queue/);
    fake.assertNotDispatchedToQueue(OrderPlaced);
  });

  it('matches wildcard queued registrations', async () => {
    const fake = EventFacade.fake();
    fake.listen('Order*', NotifySpy, true);

    await EventFacade.dispatch(new OrderShipped(4));

    fake.assertDispatchedToQueue(OrderShipped);
  });

  it('supports callback filters on queued assertions', async () => {
    const fake = EventFacade.fake();
    fake.listen(OrderPlaced.name, NotifySpy, true);

    await EventFacade.dispatch(new OrderPlaced(10));

    fake.assertDispatchedToQueue(OrderPlaced, (event) => (event as OrderPlaced).orderId === 10);
    expect(() => fake.assertDispatchedToQueue(OrderPlaced, (event) => (event as OrderPlaced).orderId === 11)).toThrow(
      /none matched the provided callback/
    );
  });

  it('keeps assertListening and getRawListeners working with registration entries', () => {
    const fake = EventFacade.fake();
    fake.listen(OrderPlaced.name, NotifySpy);

    fake.assertListening(OrderPlaced);
    fake.assertListening(OrderPlaced, NotifySpy);
    expect(fake.getRawListeners().get(OrderPlaced.name)).toContain(NotifySpy);
  });

  it('pass-through events skip faked recording but stay assertable for faked ones', async () => {
    const fake = EventFacade.fake([OrderPlaced]);

    await EventFacade.dispatch(new OrderPlaced(5));
    await EventFacade.dispatch(new OrderShipped(6));

    fake.assertDispatched(OrderPlaced);
    fake.assertNotDispatched(OrderShipped);
  });

  it('clears queued records together with dispatches', async () => {
    const fake = EventFacade.fake();
    fake.listen(OrderPlaced.name, NotifySpy, true);

    await EventFacade.dispatch(new OrderPlaced(7));
    fake.clear();

    fake.assertNothingDispatched();
    expect(fake.getQueuedDispatched(OrderPlaced)).toHaveLength(0);
  });
});
