/**
 * InteractsWithFakes
 *
 * One-stop installs of the framework's test doubles onto the application
 * under test. Each helper delegates to the facade-level fake() entry point
 * (DRY) and returns the fake for assertions; process-wide side effects
 * (outbound HTTP interception) are undone when the test case tears down,
 * and container-bound fakes vanish with the application - faking never
 * leaks between tests.
 */

import type { CacheManager } from '@/Cache/CacheManager';
import type { BroadcastFake } from '@/Support/Testing/Fakes/BroadcastFake';
import type { EventFake } from '@/Support/Testing/Fakes/EventFake';
import type { HttpFake, StubResponse } from '@/Support/Testing/Fakes/HttpFake';
import type { MailFake } from '@/Support/Testing/Fakes/MailFake';
import type { NotificationFake } from '@/Support/Testing/Fakes/NotificationFake';
import type { QueueFake } from '@/Support/Testing/Fakes/QueueFake';
import type { StorageFake } from '@/Support/Testing/Fakes/StorageFake';
import type { TestApplicationConstructor } from '@/Testing/contracts';
import { Cache } from '@/Facades/Cache';
import { Event } from '@/Facades/Event';
import { Mail as MailFacade } from '@/Facades/Mail';
import { Queue } from '@/Facades/Queue';
import { Storage } from '@/Facades/Storage';
import { Broadcast, Http, Mail, Notification } from '@/Testing/Fakes';

export function InteractsWithFakes<T extends TestApplicationConstructor>(Base: T) {
  abstract class InteractsWithFakesMixin extends Base {
    /**
     * Swap the queue for its fake: dispatched jobs are recorded, not run
     * Laravel: Queue::fake()
     */
    fakeQueue(): QueueFake {
      return Queue.fake();
    }

    /**
     * Swap the dispatcher for its fake: events are recorded, listeners
     * never fire
     * Laravel: Event::fake()
     */
    fakeEvents(events?: Array<string | (new (...args: any[]) => any)>): EventFake {
      return Event.fake(events);
    }

    /**
     * Intercept outbound fetch with recorded, stubbed responses
     * Laravel: Http::fake()
     */
    fakeHttp(stubs: Record<string, StubResponse> | StubResponse = {}): HttpFake {
      return Http.fake(stubs);
    }

    /**
     * Record mail instead of delivering it (bound as 'mailer' for app
     * code that resolves it)
     * Laravel: Mail::fake()
     */
    fakeMail(): MailFake {
      return MailFacade.fake();
    }

    /**
     * Record notifications instead of sending them (bound as
     * 'notifications')
     * Laravel: Notification::fake()
     */
    fakeNotifications(): NotificationFake {
      return Notification.fake(this.app);
    }

    /**
     * Swap the filesystem for in-memory fakes - all disks, or just the
     * named ones
     * Laravel: Storage::fake()
     */
    fakeStorage(disks?: string | string[]): StorageFake {
      return Storage.fake(disks);
    }

    /**
     * Swap the cache for an array-backed manager whose stores vanish with
     * the application
     * Laravel: Cache::fake()
     */
    fakeCache(): CacheManager {
      return Cache.fake();
    }

    /**
     * Record broadcasts instead of delivering them (bound as `broadcast`)
     * Laravel: Broadcast::fake()
     */
    fakeBroadcast(): BroadcastFake {
      return Broadcast.fake(this.app);
    }

    /**
     * Undo every process-wide fake installed through these helpers.
     * Teardown does this automatically.
     */
    restoreFakes(): void {
      Http.stop();
      Mail.stop();
      Notification.stop();
      Broadcast.stop();
    }

    constructor(...args: any[]) {
      super(...args);

      this.beforeFlushing(() => this.restoreFakes());
    }
  }

  return InteractsWithFakesMixin;
}
