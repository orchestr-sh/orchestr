/**
 * On-demand notifications
 *
 * `Notification::route('mail', address)` addresses a recipient that has no
 * model behind it: the routes ride along on an AnonymousNotifiable, which
 * answers the same `routeNotificationFor` question channels ask models, so
 * no channel branch on the kind of recipient it has.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Notification as NotificationFacade } from '@/Facades/Notification';
import { AnonymousNotifiable } from '@/Notifications/AnonymousNotifiable';
import { Notification } from '@/Notifications/Notification';
import { PendingNotification } from '@/Notifications/PendingNotification';
import { Notification as TestingNotification } from '@/Testing/Fakes';
import type { NotificationTestApp } from './support';
import { InvoicePaid, createNotificationApp } from './support';

/**
 * A relation stand-in so on-demand sends can reach the database channel
 * without a persisted notifiable.
 */
function fakeRelation(): { relation: { create(attributes: Record<string, any>): Promise<any> }; created: any[] } {
  const created: any[] = [];

  return {
    created,

    relation: {
      async create(attributes: Record<string, any>): Promise<any> {
        created.push(attributes);

        return { ...attributes };
      },
    },
  };
}

describe('PendingNotification', () => {
  it('collects routes and reports the anonymous recipient', () => {
    const pending = new PendingNotification(() => null as any, { mail: 'guest@example.com' });

    pending.route('database', 'ignored');

    const notifiable = pending.notifiable();

    expect(notifiable).toBeInstanceOf(AnonymousNotifiable);
    expect(notifiable.routes).toEqual({ mail: 'guest@example.com', database: 'ignored' });
    expect(notifiable.routeNotificationFor('mail')).toBe('guest@example.com');
    expect(notifiable.routeNotificationFor('sms')).toBeNull();
  });

  it('AnonymousNotifiable.route() replaces the route for a channel', () => {
    const notifiable = new AnonymousNotifiable({ mail: 'first@example.com' });

    notifiable.route('mail', 'second@example.com');

    expect(notifiable.routeNotificationFor('mail')).toBe('second@example.com');
  });
});

describe('on-demand delivery', () => {
  let test: NotificationTestApp;

  beforeEach(async () => {
    test = await createNotificationApp();
  });

  afterEach(async () => {
    await test.cleanup();
  });

  it('sends to a route that has no notifiable model', async () => {
    await test.sender.route('mail', 'guest@example.com').notify(new InvoicePaid({ id: 1, total: '£1' }));

    const messages = test.sentThrough();

    expect(messages).toHaveLength(1);
    expect(messages[0].to[0].address).toBe('guest@example.com');
    expect(messages[0].subject).toBe('Invoice #1 paid');
  });

  it('send() is an alias of notify() on a pending notification', async () => {
    await test.sender.route('mail', 'guest@example.com').send(new InvoicePaid({ id: 2, total: '£2' }));

    expect(test.sentThrough()).toHaveLength(1);
  });

  it('delivers on every channel whose route was collected', async () => {
    const { relation, created } = fakeRelation();

    const pending = test.sender.on({ mail: 'guest@example.com' }).route('database', relation);

    await pending.notify(new InvoicePaid({ id: 3, total: '£3' }));

    expect(test.sentThrough()).toHaveLength(1);
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe('InvoicePaid');
  });

  it('via() narrows the channels an on-demand send uses', async () => {
    const { relation, created } = fakeRelation();

    await test.sender
      .on({ mail: 'guest@example.com', database: relation })
      .via(['mail'])
      .notify(new InvoicePaid({ id: 4, total: '£4' }));

    expect(test.sentThrough()).toHaveLength(1);
    expect(created).toHaveLength(0);
  });

  it('ignores via() on the notification itself in favour of the routes', async () => {
    // InvoicePaid asks for ['mail']; an sms route is what was collected.
    class SmsOnly extends InvoicePaid {
      via(): string[] {
        return ['sms'];
      }
    }

    const delivered: Array<[any, any]> = [];

    test.sender.extend('sms', {
      async send(notifiable: any, notification: any): Promise<unknown> {
        delivered.push([notifiable.routeNotificationFor('sms'), notification]);

        return 'sms:queued';
      },
    });

    await test.sender.route('sms', '+447700900000').notify(new SmsOnly({ id: 5, total: '£5' }));

    expect(delivered).toHaveLength(1);
    expect(delivered[0][0]).toBe('+447700900000');
  });

  it('AnonymousNotifiable.notify() goes through the container router', async () => {
    const notifiable = new AnonymousNotifiable({ mail: 'direct@example.com' });

    await notifiable.notify(new InvoicePaid({ id: 6, total: '£6' }));

    expect(test.sentThrough()[0].to[0].address).toBe('direct@example.com');
  });

  it('the Notification facade routes on demand', async () => {
    await NotificationFacade.route('mail', 'facade@example.com').notify(new InvoicePaid({ id: 7, total: '£7' }));

    expect(test.sentThrough()[0].to[0].address).toBe('facade@example.com');
  });

  it('resolves the router at delivery time, so a fake installed later still records it', async () => {
    const pending = NotificationFacade.route('mail', 'late@example.com');

    const fake = NotificationFacade.fake();

    try {
      await pending.notify(new InvoicePaid({ id: 8, total: '£8' }));

      expect(test.sentThrough()).toHaveLength(0);
      fake.assertSentOnDemand(InvoicePaid, (notification: any) => notification.invoice.id === 8);
    } finally {
      TestingNotification.stop();
    }
  });

  it('fails loudly when the notification is addressed to a channel it cannot use', async () => {
    const notifiable = new AnonymousNotifiable({});

    await expect(test.sender.send(notifiable, new Notification())).rejects.toThrow(
      /No \[mail\] routes configured for \[AnonymousNotifiable\]\./
    );
  });
});
