/**
 * Notification.fake()
 *
 * The recorder replaces the whole `notifications` binding, so models,
 * facades and helpers all talk to it without knowing, and channels never
 * run. These tests pin the swap and the Laravel assertion surface the
 * ticket promises.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Notification as NotificationFacade } from '@/Facades/Notification';
import { Notification } from '@/Notifications/Notification';
import { NotificationFake } from '@/Support/Testing/Fakes/NotificationFake';
import { Notification as TestingNotification } from '@/Testing/Fakes';
import type { NotificationTestApp } from './support';
import {
  DatabaseOnlyPaid,
  InvoicePaid,
  MultiChannelPaid,
  QueuedInvoicePaid,
  User,
  createNotificationApp,
  recipient,
} from './support';

describe('Notification fake', () => {
  let test: NotificationTestApp;

  beforeEach(async () => {
    test = await createNotificationApp();
  });

  afterEach(async () => {
    TestingNotification.stop();
    await test.cleanup();
  });

  it('fake() rebinds the notifications key and returns the recorder', () => {
    const fake = NotificationFacade.fake();

    expect(fake).toBeInstanceOf(NotificationFake);
    expect(test.app.make('notifications')).toBe(fake);
    expect(TestingNotification.instance()).toBe(fake);
  });

  it('records sends instead of running channels', async () => {
    const fake = NotificationFacade.fake();
    const ada = recipient('ada@example.com');

    await NotificationFacade.send(ada, new InvoicePaid({ id: 1, total: '£1' }));

    expect(test.sentThrough()).toHaveLength(0);

    fake.assertSentTo(ada, InvoicePaid);
  });

  it('the recorder infers the channels from via() when none are given', async () => {
    const fake = new NotificationFake();
    const notification = new MultiChannelPaid({ id: 2, total: '£2' });

    await fake.send(recipient('ada@example.com'), notification);

    expect(fake.sentNotifications[0].channels).toEqual(['mail', 'database']);
  });

  it('sends through a notifiable model reach the fake', async () => {
    const fake = NotificationFacade.fake();
    const user = new User({ id: 1, name: 'Ada', email: 'ada@example.com' }, true);

    await user.notify(new InvoicePaid({ id: 3, total: '£3' }));

    fake.assertSentTo(user, InvoicePaid);
    expect(test.sentThrough()).toHaveLength(0);
  });

  it('assertSentTo passes for a recorded recipient and throws otherwise', async () => {
    const fake = NotificationFacade.fake();
    const ada = recipient('ada@example.com');
    const grace = recipient('grace@example.com');

    await fake.send(ada, new InvoicePaid({ id: 4, total: '£4' }));

    fake.assertSentTo(ada, InvoicePaid);
    fake.assertSentTo(ada, InvoicePaid, (notification: any) => notification.invoice.total === '£4');

    expect(() => fake.assertSentTo(grace, InvoicePaid)).toThrow(/was not sent to/);
    expect(() => fake.assertSentTo(ada, InvoicePaid, () => false)).toThrow(/none matched the provided callback/);
  });

  it('assertNotSentTo is the mirror image', () => {
    const fake = new NotificationFake();
    const ada = recipient('ada@example.com');

    expect(() => fake.assertNotSentTo(ada, InvoicePaid)).not.toThrow();

    void fake.send(ada, new InvoicePaid({ id: 5, total: '£5' }));

    expect(() => fake.assertNotSentTo(ada, InvoicePaid)).toThrow(/was unexpectedly sent to/);
    expect(() => fake.assertNotSentTo(ada, InvoicePaid, () => false)).not.toThrow();
    expect(() => fake.assertNotSentTo(ada, InvoicePaid, () => true)).toThrow(/matching the provided callback/);
  });

  it('assertSent and assertNotSent match by class, name, instance or predicate', () => {
    const fake = new NotificationFake();
    const notification = new InvoicePaid({ id: 6, total: '£6' });

    void fake.send(recipient('ada@example.com'), notification);

    fake.assertSent(InvoicePaid);
    fake.assertSent('InvoicePaid');
    fake.assertSent(notification);
    fake.assertSent((value: any) => value.invoice.id === 6);
    fake.assertSent(InvoicePaid, (value: any) => value.invoice.total === '£6');

    fake.assertNotSent(DatabaseOnlyPaid);
    fake.assertNotSent(InvoicePaid, (value: any) => value.invoice.id === 99);

    expect(() => fake.assertSent(DatabaseOnlyPaid)).toThrow(/No notification \[DatabaseOnlyPaid\] was sent/);
    expect(() => fake.assertSent(InvoicePaid, () => false)).toThrow(/none matched the provided callback/);
    expect(() => fake.assertNotSent(InvoicePaid)).toThrow(/was unexpectedly sent 1 time\(s\)/);
    expect(() => fake.assertNotSent(InvoicePaid, () => true)).toThrow(/was sent matching the provided callback/);
  });

  it('assertSentTimes counts the matching notifications', () => {
    const fake = new NotificationFake();

    void fake.send(recipient('ada@example.com'), new InvoicePaid({ id: 7, total: '£1' }));
    void fake.send(recipient('grace@example.com'), new InvoicePaid({ id: 8, total: '£2' }));

    fake.assertSentTimes(InvoicePaid, 2);

    expect(() => fake.assertSentTimes(InvoicePaid, 1)).toThrow(/to be sent 1 time\(s\), but it was sent 2/);
  });

  it('assertCount and assertNothingSent describe what was recorded', async () => {
    const fake = NotificationFacade.fake();

    fake.assertNothingSent();

    await NotificationFacade.send(recipient('ada@example.com'), new InvoicePaid({ id: 9, total: '£9' }));

    fake.assertCount(1);

    expect(() => fake.assertNothingSent()).toThrow(/Expected no notifications to be sent, but 1 were/);
    expect(() => fake.assertNothingSent()).toThrow(/InvoicePaid/);

    expect(() => fake.assertCount(2)).toThrow(/Expected 2 notification\(s\) to be sent, but 1 were/);
    expect(fake.size()).toBe(1);

    fake.reset();

    fake.assertNothingSent();
    expect(fake.size()).toBe(0);
  });

  it('assertSentOnDemand sees on-demand sends through the real router', async () => {
    const fake = NotificationFacade.fake();

    await NotificationFacade.route('mail', 'guest@example.com').notify(new InvoicePaid({ id: 10, total: '£10' }));

    fake.assertSentOnDemand();
    fake.assertSentOnDemand(InvoicePaid);
    fake.assertSentOnDemand(
      InvoicePaid,
      (_notification: any, notifiable: any) => notifiable.routeNotificationFor('mail') === 'guest@example.com'
    );

    expect(() => fake.assertSentOnDemand(DatabaseOnlyPaid)).toThrow(/was sent on demand/);
    expect(() => fake.assertSentOnDemand(InvoicePaid, () => false)).toThrow(/none matched the provided callback/);

    fake.assertNotSentOnDemand(DatabaseOnlyPaid);

    expect(() => fake.assertNotSentOnDemand()).toThrow(/was unexpectedly sent on demand 1 time\(s\)/);
  });

  it('queueing through the fake records the send without touching the queue', async () => {
    const fake = NotificationFacade.fake();
    const ada = recipient('ada@example.com');

    const id = await NotificationFacade.queue(ada, new QueuedInvoicePaid({ id: 11, total: '£11' }));

    expect(id).toBe('1');
    expect(test.sentThrough()).toHaveLength(0);
    fake.assertSentTo(ada, QueuedInvoicePaid);
  });

  it('sendNow records as send does, since no channel runs', async () => {
    const fake = NotificationFacade.fake();
    const ada = recipient('ada@example.com');

    await NotificationFacade.sendNow(ada, new InvoicePaid({ id: 12, total: '£12' }));

    fake.assertSentTo(ada, InvoicePaid);
    expect(fake.sentNotifications[0].channels).toEqual(['mail']);
  });

  it('the Testing installer and the facade agree on the active fake', async () => {
    const fake = TestingNotification.fake(test.app);
    const ada = recipient('ada@example.com');

    await NotificationFacade.send(ada, new InvoicePaid({ id: 13, total: '£13' }));

    TestingNotification.assertSentTo(ada, InvoicePaid);
    TestingNotification.assertSent(InvoicePaid);
    TestingNotification.assertCount(1);
    TestingNotification.assertNotSent(DatabaseOnlyPaid);
    expect(TestingNotification.instance()).toBe(fake);
    expect(NotificationFacade.fakeInstance()).toBe(fake);
  });

  it('assertions complain before anything is faked', () => {
    expect(() => TestingNotification.assertNothingSent()).toThrow(
      'Notification is not being faked. Call Notification.fake() first.'
    );
    expect(TestingNotification.instance()).toBeNull();
  });
});
