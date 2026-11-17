/**
 * The database channel and the stored notification record
 *
 * The channel writes the notification's payload through the notifiable's
 * own `notifications()` morph relation - the relation owns the morph keys,
 * the channel never guesses them - and `DatabaseNotification` is the row
 * that comes back out: a UUID key, a JSON `data` column and a `read_at`
 * stamp.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseChannel } from '@/Notifications/Channels/DatabaseChannel';
import { DatabaseNotification } from '@/Notifications/DatabaseNotification';
import { Notification } from '@/Notifications/Notification';
import type { NotificationTestApp } from './support';
import { DatabaseOnlyPaid, MultiChannelPaid, createNotificationApp, recipient } from './support';

/**
 * Only toArray(): the payload fallback the channel documents.
 */
class ArrayOnlyPaid extends Notification {
  via(): string[] {
    return ['database'];
  }

  toArray(): Record<string, any> {
    return { subject: 'Array subject', invoice: 7 };
  }
}

/**
 * Nothing at all: an empty payload is still a stored row.
 */
class SilentPaid extends Notification {
  via(): string[] {
    return ['database'];
  }
}

/**
 * A relation stand-in for the unit-level tests: records what it is asked
 * to create.
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

describe('DatabaseChannel', () => {
  it('stores the toDatabase payload under the notification name', async () => {
    const { relation, created } = fakeRelation();
    const notifiable = { routeNotificationFor: () => relation };

    await new DatabaseChannel().send(notifiable, new DatabaseOnlyPaid({ id: 9, total: '£3' }));

    expect(created).toHaveLength(1);
    expect(created[0].type).toBe('DatabaseOnlyPaid');
    expect(created[0].data).toEqual({ subject: 'Stored #9' });
    expect(created[0].read_at).toBeNull();
  });

  it('falls back to toArray when the notification has no database payload', async () => {
    const { relation, created } = fakeRelation();

    await new DatabaseChannel().send({ routeNotificationFor: () => relation }, new ArrayOnlyPaid());

    expect(created[0].data).toEqual({ subject: 'Array subject', invoice: 7 });
  });

  it('stores an empty payload when the notification describes nothing', async () => {
    const { relation, created } = fakeRelation();

    await new DatabaseChannel().send({ routeNotificationFor: () => relation }, new SilentPaid());

    expect(created[0].data).toEqual({});
  });

  it('routes through the notifications() of a model handed back as the route', async () => {
    const { relation, created } = fakeRelation();
    const owner = { notifications: () => relation };

    // The database route is the relation itself when the notifiable has
    // one; a notifiable that points at another model is routed through it.
    await new DatabaseChannel().send({ routeNotificationFor: () => owner }, new SilentPaid());

    expect(created).toHaveLength(1);
  });

  it('falls back to the notifiable own notifications() relation', async () => {
    const { relation, created } = fakeRelation();

    await new DatabaseChannel().send(
      { routeNotificationFor: () => null, notifications: () => relation },
      new SilentPaid()
    );

    expect(created).toHaveLength(1);
  });

  it('complains when there is nowhere to store the row', async () => {
    await expect(new DatabaseChannel().send(recipient('ada@example.com'), new SilentPaid())).rejects.toThrow(
      /No \[database\] routes configured for \[.*\]\./
    );
  });
});

describe('DatabaseChannel against the notifications table', () => {
  let test: NotificationTestApp;

  beforeEach(async () => {
    test = await createNotificationApp({ database: true });
  });

  afterEach(async () => {
    await test.cleanup();
  });

  it('stores a row with type, data and read_at through the morph relation', async () => {
    const user = await test.makeUser('Ada', 'ada@example.com');

    await test.sender.sendNow(user, new DatabaseOnlyPaid({ id: 12, total: '£4' }));

    const [row] = await test.rows();

    expect(row.type).toBe('DatabaseOnlyPaid');
    expect(row.notifiable_type).toBe('User');
    expect(String(row.notifiable_id)).toBe(String(user.getAttribute('id')));
    expect(JSON.parse(String(row.data))).toEqual({ subject: 'Stored #12' });
    expect(row.read_at).toBeNull();
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('reads the stored rows back through notifications()', async () => {
    const user = await test.makeUser('Ada', 'ada@example.com');

    await user.notifyNow(new DatabaseOnlyPaid({ id: 1, total: '£1' }));
    await user.notifyNow(new DatabaseOnlyPaid({ id: 2, total: '£2' }));

    const stored = (await (user.notifications() as any).getResults()) as DatabaseNotification[];

    expect(stored).toHaveLength(2);
    expect(stored[0]).toBeInstanceOf(DatabaseNotification);
    expect(stored.map((row) => row.getAttribute('data'))).toEqual([{ subject: 'Stored #1' }, { subject: 'Stored #2' }]);
  });

  it('delivers to both the mail and the database channel on one send', async () => {
    const user = await test.makeUser('Grace', 'grace@example.com');

    await user.notifyNow(new MultiChannelPaid({ id: 5, total: '£5' }));

    expect(test.sentThrough()).toHaveLength(1);
    expect(await test.rows()).toHaveLength(1);
  });

  it('marks rows read and unread again', async () => {
    const user = await test.makeUser('Ada', 'ada@example.com');

    await user.notifyNow(new DatabaseOnlyPaid({ id: 3, total: '£1' }));

    const [row] = (await (user.notifications() as any).getResults()) as DatabaseNotification[];

    expect(row.isUnread()).toBe(true);
    expect(await row.markAsRead()).toBe(true);
    expect(row.isRead()).toBe(true);
    expect(row.getAttribute('read_at')).toBeInstanceOf(Date);

    // Marking an already-read row is a no-op that still reports success.
    expect(await row.markAsRead()).toBe(true);

    expect(await row.markAsUnread()).toBe(true);
    expect(row.isUnread()).toBe(true);
    expect(row.getAttribute('read_at')).toBeNull();
  });

  it('filters stored rows with the read and unread scopes', async () => {
    const user = await test.makeUser('Ada', 'ada@example.com');

    await user.notifyNow(new DatabaseOnlyPaid({ id: 4, total: '£1' }));
    await user.notifyNow(new DatabaseOnlyPaid({ id: 5, total: '£2' }));

    const [first, second] = (await (user.notifications() as any).getResults()) as DatabaseNotification[];

    await first.markAsRead();

    expect(await DatabaseNotification.unread().count()).toBe(1);
    expect(await DatabaseNotification.read().count()).toBe(1);
    expect(await second.getAttribute('read_at')).toBeNull();
  });

  it('serialises the payload through the data column', async () => {
    const row = new DatabaseNotification({ data: { nested: { count: 2 } } });

    expect(row.getAttribute('data')).toEqual({ nested: { count: 2 } });
    expect((row as any).attributes.data).toEqual('{"nested":{"count":2}}');

    row.setDataAttribute('{"already":"json"}');

    expect(row.getAttribute('data')).toEqual({ already: 'json' });
  });
});
