/**
 * Notification events
 *
 * Every delivery fires a NotificationSent - one per channel, carrying that
 * channel's response - and a failure fires NotificationFailed with the
 * error before rethrowing it. The dispatcher is resolved lazily through
 * the container, so a missing or swapped dispatcher changes nothing else
 * about delivery.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Channel } from '@/Notifications/Contracts/Channel';
import { DatabaseChannel } from '@/Notifications/Channels/DatabaseChannel';
import { NotificationFailed } from '@/Notifications/Events/NotificationFailed';
import { NotificationSent } from '@/Notifications/Events/NotificationSent';
import { Notification } from '@/Notifications/Notification';
import { NotificationSender } from '@/Notifications/NotificationSender';
import type { NotificationTestApp } from './support';
import { BrokenPaid, MultiChannelPaid, createNotificationApp, recipient } from './support';

/**
 * Minimal dispatcher double: keeps every event it is handed. Other
 * subsystems (models, mail) dispatch through the same binding, so the
 * tests read the notification events back out by kind.
 */
function recordingDispatcher(): {
  dispatched: unknown[];
  of<T>(kind: new (...args: any[]) => T): T[];
  dispatch(event: unknown): void;
} {
  const dispatched: unknown[] = [];

  return {
    dispatched,

    of<T>(kind: new (...args: any[]) => T): T[] {
      return dispatched.filter((event): event is T => event instanceof kind);
    },

    dispatch(event: unknown): void {
      dispatched.push(event);
    },
  };
}

describe('notification events', () => {
  let test: NotificationTestApp;
  let events: ReturnType<typeof recordingDispatcher>;

  beforeEach(async () => {
    test = await createNotificationApp({ database: true });
    events = recordingDispatcher();

    test.app.instance('events', events);
  });

  afterEach(async () => {
    await test.cleanup();
  });

  it('fires one NotificationSent per channel with the channel response', async () => {
    const user = await test.makeUser('Ada', 'ada@example.com');

    await test.sender.sendNow(user, new MultiChannelPaid({ id: 1, total: '£1' }));

    const sent = events.of(NotificationSent);

    expect(sent).toHaveLength(2);

    const [mail, database] = sent;

    expect(mail).toBeInstanceOf(NotificationSent);
    expect(mail.channel).toBe('mail');
    expect(mail.notifiable).toBe(user);
    expect(mail.notification).toBeInstanceOf(MultiChannelPaid);
    expect(mail.response).toBeDefined();

    expect(database.channel).toBe('database');
    expect((database.response as any).getAttribute('type')).toBe('MultiChannelPaid');
  });

  it('fires NotificationFailed with the error and still rethrows it', async () => {
    await expect(test.sender.send(recipient('ada@example.com'), new BrokenPaid())).rejects.toThrow(
      /must have a toMail method/
    );

    const failed = events.of(NotificationFailed);

    expect(failed).toHaveLength(1);

    const failure = failed[0];

    expect(failure).toBeInstanceOf(NotificationFailed);
    expect(failure.channel).toBe('mail');
    expect(failure.notification).toBeInstanceOf(BrokenPaid);
    expect(failure.data.error).toMatch(/must have a toMail method/);
  });

  it('reports the failing notifiable alongside the notification', async () => {
    const target = recipient('ada@example.com');

    await expect(test.sender.send(target, new BrokenPaid())).rejects.toThrow();

    expect(events.of(NotificationFailed)[0].notifiable).toBe(target);
  });

  it('survives an application with no event dispatcher at all', async () => {
    const sender = new NotificationSender({}, { bound: () => false, make: () => null } as never);
    const delivered: unknown[] = [];

    class Quiet implements Channel {
      async send(): Promise<unknown> {
        delivered.push('sent');

        return null;
      }
    }

    sender.registerChannel('mail', new Quiet());

    await expect(sender.send(recipient('ada@example.com'), new Notification())).resolves.toBeUndefined();
    expect(delivered).toEqual(['sent']);
  });

  it('the database channel response is the stored row', async () => {
    const user = await test.makeUser('Grace', 'grace@example.com');

    await test.sender.sendNow(user, new MultiChannelPaid({ id: 2, total: '£2' }), ['database']);

    const [event] = events.of(NotificationSent);

    expect(event.channel).toBe('database');
    expect(event.response).toBeDefined();
    expect(await test.rows()).toHaveLength(1);
  });

  it('a custom channel response travels with the event', async () => {
    class Carrier implements Channel {
      async send(): Promise<unknown> {
        return { ticket: 'posted' };
      }
    }

    test.sender.extend('courier', new Carrier());

    class CourierPaid extends Notification {
      via(): string[] {
        return ['courier'];
      }
    }

    await test.sender.sendNow(recipient('ada@example.com'), new CourierPaid());

    const [event] = events.of(NotificationSent);

    expect(event.channel).toBe('courier');
    expect(event.response).toEqual({ ticket: 'posted' });
  });
});

/**
 * The DatabaseChannel row is what listeners read, so make sure the same
 * object the relation created is what the event carries.
 */
describe('channel responses', () => {
  it('the database channel returns the row it created', async () => {
    const created: Record<string, any> = { id: 'row-1' };
    const notifiable = {
      routeNotificationFor: () => ({
        async create(attributes: Record<string, any>): Promise<Record<string, any>> {
          return { ...created, ...attributes };
        },
      }),
    };

    const row = await new DatabaseChannel().send(notifiable, new MultiChannelPaid({ id: 4, total: '£4' }));

    expect(row).toMatchObject({ id: 'row-1', type: 'MultiChannelPaid' });
  });
});

/**
 * The real dispatcher, not a double: listeners registered on the event
 * subsystem see notification deliveries exactly like any other event.
 */
describe('notification events on the real dispatcher', () => {
  let test: NotificationTestApp;

  beforeEach(async () => {
    test = await createNotificationApp({ database: true });
  });

  afterEach(async () => {
    await test.cleanup();
  });

  it('delivers NotificationSent to subscribers', async () => {
    const dispatcher = test.app.make<{ listen(events: any, listener: any): void }>('events');
    const channels: string[] = [];

    dispatcher.listen(NotificationSent, (event: NotificationSent) => {
      channels.push(event.channel);
    });

    const user = await test.makeUser('Ada', 'ada@example.com');

    await test.sender.sendNow(user, new MultiChannelPaid({ id: 5, total: '£5' }));

    expect(channels).toEqual(['mail', 'database']);
  });

  it('delivers NotificationFailed when a channel raises', async () => {
    const dispatcher = test.app.make<{ listen(events: any, listener: any): void }>('events');
    const failures: NotificationFailed[] = [];

    dispatcher.listen(NotificationFailed, (event: NotificationFailed) => {
      failures.push(event);
    });

    await expect(test.sender.send(recipient('ada@example.com'), new BrokenPaid())).rejects.toThrow();

    expect(failures).toHaveLength(1);
    expect(failures[0].channel).toBe('mail');
  });
});
