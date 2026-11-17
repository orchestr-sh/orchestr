/**
 * NotificationSender and the Notification base class
 *
 * The sender routes (channels resolved from explicit lists, via(), or the
 * mail default), the channels deliver, and the base class describes.
 * These tests pin that split: channel registry, error surfaces, the base
 * class's opt-in hooks, and the notifications configuration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Channel } from '@/Notifications/Contracts/Channel';
import { Notification } from '@/Notifications/Notification';
import { NotificationSender, NOTIFICATIONS_DEFAULTS } from '@/Notifications/NotificationSender';
import type { NotificationTestApp } from './support';
import { BrokenPaid, InvoicePaid, recipient } from './support';
import { createNotificationApp } from './support';

describe('Notification base class', () => {
  it('defaults to the mail channel', () => {
    expect(new Notification().via({})).toEqual(['mail']);
  });

  it('leaves the channel representations undefined unless overridden', () => {
    const notification = new Notification();

    expect(notification.toMail({})).toBeUndefined();
    expect(notification.toDatabase({})).toBeUndefined();
    expect(notification.toBroadcast({})).toBeUndefined();
    expect(notification.toArray({})).toEqual({});
  });

  it('defaults the queue routing hooks to nothing', () => {
    const notification = new Notification();

    expect(notification.viaQueue()).toBeNull();
    expect(notification.viaConnection()).toBeNull();
    expect(notification.queued).toBeUndefined();
  });
});

describe('NotificationSender', () => {
  let test: NotificationTestApp;

  beforeEach(async () => {
    test = await createNotificationApp();
  });

  afterEach(async () => {
    await test.cleanup();
  });

  it('registers the three built-in channels', () => {
    expect(test.sender.getChannels()).toEqual(['mail', 'database', 'broadcast']);
  });

  it('rejects unknown channel names with the available list', () => {
    expect(() => test.sender.channel('nexmo')).toThrow(/Notification channel \[nexmo\] is not supported/);
    expect(() => test.sender.channel('nexmo')).toThrow(/Available channels: mail, database, broadcast/);
  });

  it('routes through the channels via() returns', async () => {
    await test.sender.send(recipient('ada@example.com'), new InvoicePaid({ id: 42, total: '£10' }));

    expect(test.sentThrough()).toHaveLength(1);
  });

  it('honours an explicit channel list over via()', async () => {
    // BrokenPaid would fail the mail channel's toMail requirement; asking
    // for no channels delivers nothing instead.
    await test.sender.sendNow(recipient('ada@example.com'), new BrokenPaid(), []);

    expect(test.sentThrough()).toHaveLength(0);
  });

  it('sends to a list of notifiables', async () => {
    await test.sender.send(
      [recipient('ada@example.com'), recipient('grace@example.com')],
      new InvoicePaid({ id: 7, total: '£5' })
    );

    expect(test.sentThrough().map((message) => message.to[0].address)).toEqual([
      'ada@example.com',
      'grace@example.com',
    ]);
  });

  it('fails loudly when a channel cannot deliver', async () => {
    await expect(test.sender.send(recipient('ada@example.com'), new BrokenPaid())).rejects.toThrow(
      /must have a toMail method/
    );
  });

  it('takes custom channels through extend()', async () => {
    const recorded: Array<[any, any]> = [];

    class ShoutChannel implements Channel {
      async send(notifiable: any, notification: any): Promise<unknown> {
        recorded.push([notifiable, notification]);

        return 'shouted';
      }
    }

    const sender = new NotificationSender({}, test.app);
    sender.extend('shout', new ShoutChannel());

    class Shouty extends Notification {
      via(): string[] {
        return ['shout'];
      }
    }

    const target = { notifyMe: true };

    await sender.send(target, new Shouty());

    expect(recorded[0][0]).toBe(target);
  });

  it('merges NOTIFICATIONS_DEFAULTS under the provided configuration', () => {
    const sender = new NotificationSender({ mail: { mailer: 'ses' } });

    expect(sender.config.mail?.mailer).toBe('ses');
    expect(sender.config.from?.address).toBeNull();
    expect(sender.config.queue?.connection).toBeNull();

    expect(NOTIFICATIONS_DEFAULTS.from?.address).toBeNull();
  });
});
