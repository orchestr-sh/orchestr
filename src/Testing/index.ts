/**
 * Testing Module
 *
 * The Laravel-shaped testing layer on top of the framework's own HTTP
 * kernel, database, queue, event, filesystem and cache services:
 *
 * - `TestCase` boots a fresh application per test, registers providers,
 *   and tears everything down between tests;
 * - `TestClient` builds requests and drives them through the Kernel
 *   (no second server implementation), `TestResponse` asserts the result;
 * - `RefreshDatabase` migrates once and rolls each test back,
 *   `DatabaseTransactions` only wraps and rolls back;
 * - the `Http` / `Mail` / `Notification` installers (plus
 *   `Queue.fake()`, `Event.fake()`, `Storage.fake()` and `Cache.fake()`
 *   on their facades) replace side-effecting services with recorders;
 * - the Clock helpers travel, freeze and restore time.
 *
 * @example
 * ```typescript
 * import { RefreshDatabase, TestCase } from '@orchestr-sh/orchestr/Testing';
 *
 * class UserTest extends RefreshDatabase(TestCase) {
 *   protected routes(router) {
 *     router.post('/users', async (req) => ({ id: await User.create(req.all()) }));
 *   }
 *
 *   async testCreatesAUser() {
 *     const response = await this.postJson('/users', { name: 'Ada' });
 *
 *     response.assertCreated().assertJsonPath('name', 'Ada');
 *
 *     await this.assertDatabaseHas('users', { name: 'Ada' });
 *   }
 * }
 *
 * new UserTest();
 * ```
 */

export { BaseTestCase, TestCase } from '@/Testing/TestCase';
export type { ServiceProviderClass } from '@/Testing/TestCase';

export { TestClient } from '@/Testing/TestClient';
export type { CallOptions, ExceptionExpectation } from '@/Testing/TestClient';

export { TestResponse } from '@/Testing/TestResponse';
export type { ParsedCookie, TestResponseInit } from '@/Testing/TestResponse';

export { DatabaseTransactions } from '@/Testing/DatabaseTransactions';
export { RefreshDatabase } from '@/Testing/RefreshDatabase';

export { clock, clockNow, freezeTime, travel, travelBack, travelTo } from '@/Testing/Clock';
export type { TimeLike } from '@/Testing/Clock';

export { Http, Mail, Notification, Broadcast } from '@/Testing/Fakes';

export { InteractsWithDatabase } from '@/Testing/Concerns/InteractsWithDatabase';
export type { DatabaseCriteria, ModelLike } from '@/Testing/Concerns/InteractsWithDatabase';
export { InteractsWithExceptionHandling, ThrowingHandler } from '@/Testing/Concerns/InteractsWithExceptionHandling';
export { InteractsWithFakes } from '@/Testing/Concerns/InteractsWithFakes';
export { InteractsWithHttp } from '@/Testing/Concerns/InteractsWithHttp';
export { InteractsWithTime } from '@/Testing/Concerns/InteractsWithTime';

export type { TestApplication, TestApplicationConstructor } from '@/Testing/contracts';

// Fakes the testing layer installs
export { createFakeCacheManager, FakeCacheManager } from '@/Support/Testing/Fakes/CacheFake';
export { BroadcastFake } from '@/Support/Testing/Fakes/BroadcastFake';
export type { RecordedBroadcast } from '@/Support/Testing/Fakes/BroadcastFake';
export { EventFake } from '@/Support/Testing/Fakes/EventFake';
export { fakeHttp, HttpFake } from '@/Support/Testing/Fakes/HttpFake';
export type { HttpRequestOptions, RecordedRequest, StubResponse } from '@/Support/Testing/Fakes/HttpFake';
export { MailFake } from '@/Support/Testing/Fakes/MailFake';
export type { SentMail } from '@/Support/Testing/Fakes/MailFake';
export { NotificationFake } from '@/Support/Testing/Fakes/NotificationFake';
export type { SentNotification } from '@/Support/Testing/Fakes/NotificationFake';
export { QueueFake } from '@/Support/Testing/Fakes/QueueFake';
export type { PushedJobRecord } from '@/Support/Testing/Fakes/QueueFake';
export {
  ArrayFilesystemAdapter,
  createStorageFake,
  FakeFilesystemDisk,
  FakeFilesystemManager,
  StorageFake,
} from '@/Support/Testing/Fakes/StorageFake';
