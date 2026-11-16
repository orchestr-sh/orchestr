/**
 * Fakes for queue, events, mail, notifications, HTTP, cache and storage
 *
 * Every side-effecting service must be replaceable with a recorder that
 * answers Laravel-style assertions, and the TestCase installs must be
 * undone automatically between tests (fetch interception especially must
 * never leak).
 */

import { describe, it, expect } from 'vitest';
import type { CacheManager } from '@/Cache/CacheManager';
import type { Disk } from '@/Filesystem/Contracts/Disk';
import type { EventFake } from '@/Support/Testing/Fakes/EventFake';
import type { QueueFake } from '@/Support/Testing/Fakes/QueueFake';
import { Event } from '@/Events/Event';
import { Cache } from '@/Facades/Cache';
import { Storage } from '@/Facades/Storage';
import { Job } from '@/Queue/Job';
import { FakeCacheManager as FakeCacheManagerClass } from '@/Support/Testing/Fakes/CacheFake';
import { TestCase } from '@/Testing';

class WelcomeJob extends Job {
  constructor(public readonly userId: number = 1) {
    super();
  }

  async handle(): Promise<void> {
    // never executed against a fake
  }
}

class GoodbyeJob extends Job {
  async handle(): Promise<void> {
    // never executed against a fake
  }
}

class OrderPlaced extends Event {
  constructor(public readonly orderId: number = 7) {
    super();
  }
}

class FakesTestCase extends TestCase {
  async testQueueFakeRecordsPushedJobs() {
    const queue = this.fakeQueue();

    await WelcomeJob.dispatch(42);

    queue.assertPushed(WelcomeJob);
    queue.assertPushedTimes(WelcomeJob, 1);
    queue.assertNotPushed(GoodbyeJob);
    expect(() => queue.assertNothingPushed()).toThrow();

    const pushed = queue.pushed(WelcomeJob)[0] as WelcomeJob;

    expect(pushed.userId).toBe(42);
  }

  async testEventFakeRecordsDispatchedEvents() {
    const events = this.fakeEvents();

    const dispatcher = this.app.make<{ dispatch(event: unknown): Promise<unknown[]> }>('events');

    await dispatcher.dispatch(new OrderPlaced(7));

    events.assertDispatched(OrderPlaced);
    events.assertDispatched(OrderPlaced, (event) => (event as OrderPlaced).orderId === 7);
    events.assertNotDispatched('UserRegistered');

    expect(events.getDispatchedCount()).toBe(1);
  }

  async testHttpFakeInterceptsOutboundFetch() {
    const http = this.fakeHttp({
      'https://api.example.com/*': { status: 200, body: { from: 'stub' } },
    });

    const response = await fetch('https://api.example.com/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ada' }),
    });

    expect(await response.json()).toEqual({ from: 'stub' });

    http.assertSent('https://api.example.com/users');
    http.assertSent((request) => request.method === 'POST' && String(request.body).includes('Ada'));
    http.assertNotSent('https://api.example.com/secrets');
    http.assertSentCount(1);
    expect(http.recorded()[0].url).toBe('https://api.example.com/users');
  }

  async testMailFakeRecordsSentMessages() {
    const mail = this.fakeMail();

    const mailable = { subject: 'Welcome' };

    await mail.to('ada@example.com').send(mailable);
    await mail.queue({ subject: 'Later' }, ['bob@example.com']);

    mail.assertSent(mailable);
    mail.assertSent((value: any) => value.subject === 'Welcome');
    mail.assertQueued((queued: any) => queued.subject === 'Later');
    mail.assertNotSent((value: any) => value.subject === 'Goodbye');
    expect(() => mail.assertNothingSent()).toThrow();

    expect(this.app.make('mailer')).toBe(mail);
  }

  async testNotificationFakeRecordsSends() {
    const notifications = this.fakeNotifications();

    const recipient = { id: 3 };
    const notification = { via: () => ['mail'] };

    await notifications.send(recipient, notification);

    notifications.assertSentTo(recipient, notification);
    notifications.assertSent(notification);
    notifications.assertSentTimes(notification, 1);
    notifications.assertNotSent((value: any) => value.late === true);
    expect(() => notifications.assertNothingSent()).toThrow();
  }

  async testStorageFakeKeepsWritesInMemory() {
    const storage = this.fakeStorage('local');

    await Storage.put('notes/hello.txt', 'hi there');

    expect(await Storage.get('notes/hello.txt')).toEqual(Buffer.from('hi there'));
    await storage.assertExists('notes/hello.txt');
    await storage.assertMissing('notes/gone.txt');
    await storage.assertExistsIn('local', 'notes/hello.txt');
    storage.assertDirectoryExists('notes');
    storage.assertDirectoryMissing('elsewhere');

    expect(await storage.disk('local').allFiles()).toEqual(['notes/hello.txt']);
  }

  async testStorageFakeCanBeScopedToOneDisk() {
    this.fakeStorage('public');

    const publicDisk = Storage.disk('public') as Disk;
    const localDisk = Storage.disk('local');

    await publicDisk.put('on-public.txt', 'yes');

    expect(await publicDisk.exists('on-public.txt')).toBe(true);
    // the local disk is untouched: writing it hits the (non-existent) real root
    expect(await localDisk.exists('on-public.txt')).toBe(false);
  }

  async testCacheFakeResolvesEveryStoreToArrayAndIsolates() {
    const cache = this.fakeCache() as CacheManager;

    await cache.store().put('inside', 'the fake', 60);

    expect(await cache.get('inside')).toBe('the fake');
    expect(await Cache.get('inside')).toBe('the fake');

    // unknown store names still resolve while faked
    const anything = cache.store('totally-made-up');

    await anything.put('x', 1, 10);
    expect(await anything.get('x')).toBe(1);
  }

  async testFakesBindIntoTheCurrentApplication() {
    this.fakeQueue();
    this.fakeCache();

    expect(this.app.resolved('queue')).toBe(true);
    expect(this.app.make('cache')).toBeInstanceOf(FakeCacheManagerClass);
  }
}

new FakesTestCase();

describe('fake lifecycle', () => {
  class LeakTest extends TestCase {
    async testItFakesHttpOnce() {
      this.fakeHttp({ 'https://one.test/*': 'first' });

      const response = await fetch('https://one.test/ping');

      expect(await response.text()).toBe('first');
    }

    async testItSeesRealFetchAfterTeardown() {
      // The previous test's fake must have been restored: fetch is the
      // runtime's again (calling a nonexistent host fails at the network
      // layer, not the fake's stub table).
      await expect(fetch('https://this-host-does-not-exist.invalid/')).rejects.toThrow();
    }
  }

  new LeakTest();

  it('http fake answers plain object stubs as JSON', async () => {
    const { fakeHttp } = await import('@/Support/Testing/Fakes/HttpFake');

    const http = fakeHttp({ 'https://x.test/data': { answer: 42 } });

    try {
      const response = await fetch('https://x.test/data');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.json()).toEqual({ answer: 42 });
      http.assertSent('https://x.test/data');
    } finally {
      http.restore();
    }
  });

  it('http fake supports closure stubs and unmatched pass-through', async () => {
    const { fakeHttp } = await import('@/Support/Testing/Fakes/HttpFake');

    const http = fakeHttp((request) => ({ status: 201, body: `echo:${request.url}` }));

    try {
      const response = await fetch('https://any.test/thing');

      expect(response.status).toBe(201);
      expect(await response.text()).toBe('echo:https://any.test/thing');
    } finally {
      http.restore();
    }
  });

  it('event and queue fakes reset between installs', async () => {
    const { EventFake: Fake } = await import('@/Support/Testing/Fakes/EventFake');
    const { QueueFake } = await import('@/Support/Testing/Fakes/QueueFake');

    const events: EventFake = new Fake({} as any);

    await events.dispatch(new OrderPlaced());
    events.assertDispatched(OrderPlaced);
    events.reset();
    events.assertNothingDispatched();

    const queue: QueueFake = new QueueFake();

    await queue.push(new WelcomeJob(1));
    queue.assertPushed(WelcomeJob);
    queue.reset();
    queue.assertNothingPushed();
  });
});
