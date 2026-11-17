/**
 * The Notifiable concern
 *
 * Gives an Ensemble model `notify` / `notifyNow` / `routeNotificationFor`
 * / `notifications()`. The concern never talks to a channel: it resolves
 * the application's notification router (`notifications` container key,
 * so a fake swaps in transparently) and lets it route.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleCollection } from '@/Database/Ensemble/EnsembleCollection';
import { Application } from '@/Foundation/Application';
import { DatabaseNotification } from '@/Notifications/DatabaseNotification';
import { Notifiable, resolveNotificationRouter } from '@/Notifications/Notifiable';
import { notification } from '@/Support/helpers';
import type { NotificationTestApp } from './support';
import {
  DatabaseOnlyPaid,
  InvoicePaid,
  MultiChannelPaid,
  QueuedInvoicePaid,
  User,
  createNotificationApp,
} from './support';

class Admin extends Notifiable(Ensemble) {
  static fillable = ['name', 'email', 'slack'];

  protected table: string = 'users';

  getTable(): string {
    return 'users';
  }

  routeNotificationForMail(): string {
    return `admin+${this.getAttribute('name')}@example.com`;
  }
}

class Prefixed extends Notifiable(Ensemble) {
  protected table: string = 'users';

  getTable(): string {
    return 'users';
  }

  routeNotificationForDatabase: string = 'a-property-not-a-relation';
}

describe('Notifiable', () => {
  let test: NotificationTestApp;

  beforeEach(async () => {
    test = await createNotificationApp({ database: true });
  });

  afterEach(async () => {
    await test.cleanup();
  });

  it('notify() fans out over the channels via() returns', async () => {
    const user = await test.makeUser('Ada', 'ada@example.com');

    await user.notify(new MultiChannelPaid({ id: 1, total: '£1' }));

    expect(test.sentThrough()).toHaveLength(1);
    expect(await test.rows()).toHaveLength(1);
  });

  it('notify() accepts a list of notifications', async () => {
    const user = await test.makeUser('Ada', 'ada@example.com');

    await user.notify([
      new DatabaseOnlyPaid({ id: 1, total: '£1' }),
      new DatabaseOnlyPaid({ id: 2, total: '£2' }),
      new InvoicePaid({ id: 3, total: '£3' }),
    ]);

    expect(await test.rows()).toHaveLength(2);
    expect(test.sentThrough()).toHaveLength(1);
  });

  it('notifyNow() delivers even when the notification is queueable', async () => {
    const user = await test.makeUser('Ada', 'ada@example.com');

    await user.notifyNow(new QueuedInvoicePaid({ id: 4, total: '£4' }));

    expect(test.sentThrough()).toHaveLength(1);
  });

  it('notify() on a model with no notifications provider is a clear error', async () => {
    const user = await test.makeUser('Ada', 'ada@example.com');
    const bare = new Application(test.base);

    // The bare application registers nothing, so the router is missing.
    expect(bare.bound('notifications')).toBe(false);
    expect(resolveNotificationRouter).toThrow('Notifications are not available.');
    expect(() => notification()).toThrow('Notifications are not available.');
    await expect(user.notify(new InvoicePaid({ id: 1, total: '£1' }))).rejects.toThrow(
      'Notifications are not available. Register the NotificationServiceProvider first.'
    );
  });

  it('resolves the router from the container on every call', async () => {
    expect(resolveNotificationRouter()).toBe(test.sender);
    expect(notification()).toBe(test.sender);
  });

  it('prefers a routeNotificationForMail method over the email attribute', async () => {
    const admin = (await Admin.create({ name: 'root', email: 'root@example.com' })) as Admin;

    await admin.notify(new InvoicePaid({ id: 8, total: '£8' }));

    expect(test.sentThrough()[0].to[0].address).toBe('admin+root@example.com');
  });

  it('reads a routeNotificationFor{Channel} property when there is no method', () => {
    const prefixed = new Prefixed({ id: 9, name: 'Ada', email: 'ada@example.com' }, true);

    expect(prefixed.routeNotificationFor('database')).toBe('a-property-not-a-relation');
    expect(prefixed.routeNotificationFor('mail')).toBe('ada@example.com');
    expect(prefixed.routeNotificationFor('broadcast')).toBeNull();
  });

  it('defaults the database route to the notifications relation', async () => {
    const user = await test.makeUser('Ada', 'ada@example.com');

    const relation = user.routeNotificationFor('database') as any;

    expect(typeof relation.create).toBe('function');
    expect(relation.constructor.name).toBe('MorphMany');
  });

  it('notifications() is the morph relation over stored rows', async () => {
    const user = await test.makeUser('Grace', 'grace@example.com');

    await user.notify(new DatabaseOnlyPaid({ id: 11, total: '£11' }));

    const stored = (await (user.notifications() as any).getResults()) as DatabaseNotification[];

    expect(stored).toHaveLength(1);
    expect(stored[0].getAttribute('type')).toBe('DatabaseOnlyPaid');
    expect(stored[0].getTable()).toBe('notifications');
  });

  it('a list of notifiables is delivered to each of them', async () => {
    const ada = await test.makeUser('Ada', 'ada@example.com');
    const grace = await test.makeUser('Grace', 'grace@example.com');

    await test.sender.send([ada, grace], new InvoicePaid({ id: 12, total: '£12' }));

    expect(test.sentThrough().map((message) => message.to[0].address)).toEqual([
      'ada@example.com',
      'grace@example.com',
    ]);
  });

  it('a collection of notifiables is delivered to one by one', async () => {
    await test.makeUser('Ada', 'ada@example.com');
    await test.makeUser('Grace', 'grace@example.com');

    const users = new EnsembleCollection(await User.query().get());

    expect(users.all()).toHaveLength(2);

    await test.sender.send(users, new InvoicePaid({ id: 13, total: '£13' }));

    expect(test.sentThrough().map((message) => message.to[0].address)).toEqual([
      'ada@example.com',
      'grace@example.com',
    ]);
  });
});
