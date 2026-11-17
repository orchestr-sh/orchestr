/**
 * Queued notifications
 *
 * A notification marked `queued = true` is dispatched to a worker as a
 * SendQueuedNotification job instead of being delivered inline; the job
 * calls back into the sender with sendNow, so a worker never re-queues
 * the notification it was handed. `sendNow` and `Notification::sendNow`
 * always bypass the queue, and `viaQueue` / `viaConnection` /
 * `notifications.queue.connection` say where the job goes.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Container } from '@/Container/Container';
import type { QueueFake } from '@/Support/Testing/Fakes/QueueFake';
import { Queue } from '@/Facades/Queue';
import { Notification } from '@/Notifications/Notification';
import { NotificationSender } from '@/Notifications/NotificationSender';
import { SendQueuedNotification } from '@/Notifications/SendQueuedNotification';
import { Notification as TestingNotification } from '@/Testing/Fakes';
import type { NotificationTestApp } from './support';
import {
  DatabaseOnlyPaid,
  HighQueueInvoicePaid,
  InvoicePaid,
  QueuedInvoicePaid,
  createNotificationApp,
  recipient,
} from './support';

class RedisQueueInvoicePaid extends QueuedInvoicePaid {
  viaConnection(): string {
    return 'redis';
  }

  viaQueue(): string {
    return 'notifications';
  }
}

/**
 * A notification that decides for itself whether to queue.
 */
class ConditionalPaid extends InvoicePaid {
  public shouldQueueValue = false;

  shouldQueue(): boolean {
    return this.shouldQueueValue;
  }
}

/**
 * A container that binds nothing: queueing is unavailable.
 */
function emptyContainer(): Container {
  return {
    bound: () => false,
    make: () => null,
  } as unknown as Container;
}

describe('queued notifications', () => {
  let test: NotificationTestApp;
  let queue: QueueFake;

  beforeEach(async () => {
    test = await createNotificationApp();
    queue = Queue.fake();
  });

  afterEach(async () => {
    TestingNotification.stop();
    await test.cleanup();
  });

  it('send() puts a queueable notification on the queue instead of delivering it', async () => {
    await test.sender.send(recipient('ada@example.com'), new QueuedInvoicePaid({ id: 1, total: '£1' }));

    expect(test.sentThrough()).toHaveLength(0);
    queue.assertPushed(SendQueuedNotification);
  });

  it('the job carries the recipients, the notification and the channels', async () => {
    const target = recipient('ada@example.com');

    await test.sender.send(target, new QueuedInvoicePaid({ id: 2, total: '£2' }), ['mail']);

    const job = queue.pushedJobs[0].job as SendQueuedNotification;

    expect(job.notifiables).toEqual([target]);
    expect(job.notification).toBeInstanceOf(QueuedInvoicePaid);
    expect(job.channels).toEqual(['mail']);
    expect(job.sender).toBe(test.sender);
  });

  it('sendNow() delivers a queueable notification inline', async () => {
    await test.sender.sendNow(recipient('ada@example.com'), new QueuedInvoicePaid({ id: 3, total: '£3' }));

    expect(test.sentThrough()).toHaveLength(1);
    queue.assertNothingPushed();
  });

  it('queue() dispatches delivery explicitly for a non-queueable notification', async () => {
    const id = await test.sender.queue(recipient('ada@example.com'), new InvoicePaid({ id: 4, total: '£4' }));

    expect(typeof id).toBe('string');
    expect(test.sentThrough()).toHaveLength(0);
    queue.assertPushed(SendQueuedNotification);
  });

  it('later() puts the delay on the job', async () => {
    await test.sender.later(120, recipient('ada@example.com'), new QueuedInvoicePaid({ id: 5, total: '£5' }));

    expect(queue.pushedJobs[0].delay).toBe(120);
  });

  it('honours viaQueue() on the notification', async () => {
    await test.sender.send(recipient('ada@example.com'), new HighQueueInvoicePaid({ id: 6, total: '£6' }));

    queue.assertPushedOn('high', SendQueuedNotification);
  });

  it('honours viaConnection() and viaQueue() together', async () => {
    await test.sender.send(recipient('ada@example.com'), new RedisQueueInvoicePaid({ id: 7, total: '£7' }));

    const record = queue.pushedJobs[0];

    expect(record.connection).toBe('redis');
    expect(record.queue).toBe('notifications');
  });

  it('falls back to the notifications.queue.connection configuration', async () => {
    const configured = await createNotificationApp({
      notifications: { queue: { connection: 'database' } },
    });
    const configuredQueue = Queue.fake();

    try {
      await configured.sender.send(recipient('ada@example.com'), new QueuedInvoicePaid({ id: 8, total: '£8' }));

      expect(configuredQueue.pushedJobs[0].connection).toBe('database');
    } finally {
      await configured.cleanup();
    }
  });

  it('shouldQueue() lets a notification decide at send time', async () => {
    const conditional = new ConditionalPaid({ id: 9, total: '£9' });

    await test.sender.send(recipient('ada@example.com'), conditional);

    queue.assertNothingPushed();
    expect(test.sentThrough()).toHaveLength(1);

    conditional.shouldQueueValue = true;

    await test.sender.send(recipient('ada@example.com'), conditional);

    queue.assertPushed(SendQueuedNotification);
    expect(test.sentThrough()).toHaveLength(1);
  });

  it('a notification addressed to several recipients queues one job', async () => {
    await test.sender.send(
      [recipient('ada@example.com'), recipient('grace@example.com')],
      new QueuedInvoicePaid({ id: 10, total: '£10' })
    );

    queue.assertPushedTimes(SendQueuedNotification, 1);
    expect((queue.pushedJobs[0].job as SendQueuedNotification).notifiables).toHaveLength(2);
  });

  it('says what to register when the queue subsystem is missing', async () => {
    const sender = new NotificationSender({}, emptyContainer());

    await expect(
      sender.send(recipient('ada@example.com'), new QueuedInvoicePaid({ id: 11, total: '£11' }))
    ).rejects.toThrow(
      'Queueing notifications requires the queue subsystem. Register the QueueServiceProvider first, or send the notification synchronously with sendNow().'
    );
  });
});

describe('the queued job', () => {
  let test: NotificationTestApp;

  beforeEach(async () => {
    test = await createNotificationApp();
  });

  afterEach(async () => {
    await test.cleanup();
  });

  it('delivers through sendNow when a worker runs it', async () => {
    const target = recipient('ada@example.com');

    await test.sender.send(target, new QueuedInvoicePaid({ id: 12, total: '£12' }));

    expect(test.sentThrough()).toHaveLength(1);
    expect(test.sentThrough()[0].subject).toBe('Invoice #12 paid');
  });

  it('never re-queues the notification it was handed', async () => {
    const delivered: unknown[] = [];

    // No queue binding at all: a second trip through send() would throw.
    const sender = new NotificationSender({}, emptyContainer());

    sender.extend('mail', {
      async send(notifiable: any, notification: any): Promise<unknown> {
        delivered.push([notifiable, notification]);

        return 'delivered';
      },
    });

    const notification = new QueuedInvoicePaid({ id: 13, total: '£13' });
    const job = new SendQueuedNotification(sender, [recipient('ada@example.com')], notification, ['mail']);

    await job.handle();

    expect(delivered).toHaveLength(1);
  });

  it('pins the channels the send asked for', async () => {
    const job = new SendQueuedNotification(
      test.sender,
      [recipient('ada@example.com')],
      new DatabaseOnlyPaid({ id: 14, total: '£14' }),
      ['database']
    );

    expect(job.channels).toEqual(['database']);
    expect(job.notification).toBeInstanceOf(DatabaseOnlyPaid);
  });

  it('is a Job with the notification payload visible to workers', () => {
    const notification = new Notification();
    const job = new SendQueuedNotification(test.sender, [], notification);

    expect(job.notification).toBe(notification);
    expect(JSON.stringify(job)).toEqual(expect.any(String));
  });
});
