/**
 * TestCase
 *
 * The Laravel-style base class for application tests. Each test gets a
 * freshly created application (synchronously in the constructor) and a
 * booted one (on setUp), with a Router and Kernel wired the way a real
 * bootstrap does - and the whole thing flushed on tearDown so nothing
 * leaks between tests.
 *
 * The fluent surface (get/post, actingAs, database assertions, fakes,
 * time travel, exception expectations) is composed from the concerns in
 * ./Concerns, keeping request building, response assertions, database
 * assertions and time control separate classes (SRP):
 *
 *   export class TestCase extends InteractsWithTime(
 *     InteractsWithFakes(
 *       InteractsWithExceptionHandling(
 *         InteractsWithDatabase(
 *           InteractsWithHttp(BaseTestCase)
 *         )
 *       )
 *     )
 *   ) {}
 *
 * Two usage shapes work:
 *
 * 1. PHPUnit-style - declare `test*` methods on the subclass and
 *    instantiate it once at module level; the constructor collects the
 *    methods into a describe block with full setUp/tearDown isolation:
 *
 *    ```typescript
 *    class ExampleTest extends TestCase {
 *      protected defineRoutes(router: Router): void { ... }
 *      async testItGreets() { (await this.get('/'))->assertSee('Hi'); }
 *    }
 *    new ExampleTest();
 *    ```
 *
 * 2. Vitest-style - construct the case and call setUp/tearDown from the
 *    file's hooks (helpers boot lazily, so beforeEach is optional):
 *
 *    ```typescript
 *    const test = new ExampleTest();
 *    it('greets', async () => { await test.get('/')->assertOk(); });
 *    afterEach(() => test.tearDown());
 *    ```
 */

import type { ServiceProvider as ServiceProviderContract } from '@/Foundation/ServiceProvider';
import { CacheServiceProvider } from '@/Cache/CacheServiceProvider';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { DatabaseServiceProvider } from '@/Database/DatabaseServiceProvider';
import { EventServiceProvider } from '@/Events/EventServiceProvider';
import { FilesystemServiceProvider } from '@/Filesystem/FilesystemServiceProvider';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { Kernel } from '@/Foundation/Http/Kernel';
import { QueueServiceProvider } from '@/Queue/QueueServiceProvider';
import { Route } from '@/Routing/Route';
import { Router } from '@/Routing/Router';
import { SessionServiceProvider } from '@/Session/SessionServiceProvider';
import { Facade } from '@/Support/Facade';
import { InteractsWithDatabase } from '@/Testing/Concerns/InteractsWithDatabase';
import { InteractsWithExceptionHandling } from '@/Testing/Concerns/InteractsWithExceptionHandling';
import { InteractsWithFakes } from '@/Testing/Concerns/InteractsWithFakes';
import { InteractsWithHttp } from '@/Testing/Concerns/InteractsWithHttp';
import { InteractsWithTime } from '@/Testing/Concerns/InteractsWithTime';
import { TestClient } from '@/Testing/TestClient';

/**
 * A service provider class the container can instantiate
 */
export type ServiceProviderClass = new (app: Application) => ServiceProviderContract;

export abstract class BaseTestCase {
  /**
   * The application under test
   */
  public app!: Application;

  /**
   * The router routes are declared on
   */
  public router!: Router;

  /**
   * The HTTP kernel requests are driven through
   */
  public kernel!: Kernel;

  /**
   * The test client wrapping the kernel
   */
  public client!: TestClient;

  /**
   * Whether the application has booted for the current test
   */
  protected booted: boolean = false;

  /**
   * Whether the (un-booted) application currently exists
   */
  protected applicationCreated: boolean = false;

  /**
   * Whether teardown disconnects the database the test resolved;
   * RefreshDatabase keeps the shared migrated connection by flipping this
   * off
   */
  public disconnectDatabaseOnFlush: boolean = true;

  /**
   * Callbacks run right before the application is flushed; registered
   * once per test-case instance (the concerns wire their restores in
   * their constructors), so they survive every boot cycle.
   */
  protected flushingCallbacks: Array<() => void | Promise<void>> = [];

  /**
   * Callbacks run after the application has booted
   */
  protected createdCallbacks: Array<() => void | Promise<void>> = [];

  /**
   * Callbacks run before the application is destroyed
   */
  protected destroyedCallbacks: Array<() => void | Promise<void>> = [];

  constructor() {
    this.createApplication();
    this.registerWithRunner();
  }

  // ==================== Overridable application shape ====================

  /**
   * The application base path; nowhere real by default so no .env or
   * config/ directory of the surrounding project leaks into tests
   */
  protected basePath(): string {
    return '/test';
  }

  /**
   * Service providers registered on every test application - the pieces
   * feature tests reach for by default. Override to add or replace.
   */
  protected providers(): ServiceProviderClass[] {
    return [
      DatabaseServiceProvider,
      CacheServiceProvider,
      EventServiceProvider as unknown as ServiceProviderClass,
      FilesystemServiceProvider,
      QueueServiceProvider,
      SessionServiceProvider,
    ];
  }

  /**
   * Default configuration: sqlite in-memory, array caches/sessions, the
   * sync queue. Override and layer on top of `super.defaultConfig()`.
   */
  protected defaultConfig(): Record<string, any> {
    return {
      app: { name: 'Orchestr Test', env: 'testing', debug: true, key: 'base64:dGVzdC1rZXktdGhyb3V0aC10aGUtd3lyZQ==' },
      cache: { default: 'array', prefix: 'orchestr_test_', stores: { array: { driver: 'array' } } },
      database: {
        default: 'sqlite',
        connections: {
          sqlite: { adapter: 'drizzle', driver: 'better-sqlite3', database: ':memory:' },
        },
      },
      filesystems: {
        default: 'local',
        disks: {
          local: { driver: 'local', root: 'storage/app' },
          public: { driver: 'local', root: 'storage/app/public', url: '/storage' },
          null: { driver: 'null' },
        },
      },
      queue: { default: 'sync', connections: { sync: { driver: 'sync' } } },
      session: { driver: 'array', lifetime: 120 },
    };
  }

  /**
   * Adjust configuration before providers register (the Laravel
   * `defineEnvironment` hook). Must be synchronous - the configuration
   * needs to be final before registration reads from it.
   */
  protected defineEnvironment(config: Config): void {
    // no-op by default
  }

  /**
   * Declare the test application's routes (the Laravel
   * `defineRoutes`/routes-file hook); runs after boot
   */
  protected defineRoutes(router: Router): void | Promise<void> {
    // no-op by default
  }

  // ==================== Lifecycle ====================

  /**
   * Boot the application for the current test; idempotent, and helpers
   * call it lazily so an explicit beforeEach is optional
   */
  async setUp(): Promise<void> {
    if (this.booted) {
      return;
    }

    if (!this.applicationCreated) {
      this.createApplication();
    }

    await this.app.boot();

    await this.afterApplicationBoot();

    await this.defineRoutes(this.router);

    this.booted = true;

    for (const callback of this.createdCallbacks.splice(0)) {
      await callback();
    }
  }

  /**
   * Flush the application and undo anything a test registered globally
   */
  async tearDown(): Promise<void> {
    for (const callback of this.destroyedCallbacks.splice(0)) {
      await callback();
    }

    await this.flushApplication();
  }

  /**
   * Rebuild the application from scratch, like Laravel's
   * refreshApplication()
   */
  async refreshApplication(): Promise<void> {
    const wasBooted = this.booted;

    await this.flushApplication();

    this.createApplication();

    if (wasBooted) {
      await this.setUp();
    }
  }

  /**
   * Run work immediately before the application is flushed at teardown;
   * concerns use this to undo global side effects (fakes, time travel)
   */
  beforeFlushing(callback: () => void | Promise<void>): void {
    this.flushingCallbacks.push(callback);
  }

  /**
   * Run work once the application has booted for this test
   * Laravel: afterApplicationCreated
   */
  afterApplicationCreated(callback: () => void | Promise<void>): void {
    if (this.booted) {
      void callback();

      return;
    }

    this.createdCallbacks.push(callback);
  }

  /**
   * Run work right before the application is destroyed
   * Laravel: beforeApplicationDestroyed
   */
  beforeApplicationDestroyed(callback: () => void | Promise<void>): void {
    this.destroyedCallbacks.push(callback);
  }

  /**
   * Hook concerns use to wire themselves into the freshly created
   * application parts (client, kernel)
   */
  afterApplicationBoot(): void | Promise<void> {
    // no-op by default
  }

  // ==================== Application construction ====================

  /**
   * Create (but do not boot) the application, router, kernel and client
   */
  protected createApplication(): void {
    this.app = new Application(this.basePath());

    const config = new Config(this.defaultConfig());

    this.app.instance('config', config);

    // Environment shaping happens before any provider gets to read config
    this.defineEnvironment(config);

    Facade.setFacadeApplication(this.app);
    Facade.clearResolvedInstances();

    this.router = new Router(this.app);
    this.app.instance('router', this.router);

    for (const provider of this.providers()) {
      this.app.register(provider);
    }

    this.kernel = new Kernel(this.app);
    this.app.instance('kernel', this.kernel);

    this.client = new TestClient(this.app, this.kernel);

    this.applicationCreated = true;
    this.booted = false;
  }

  /**
   * Destroy the application: run flush hooks, drop connections the test
   * opened, reset static route state and facade caches
   */
  protected async flushApplication(): Promise<void> {
    for (const callback of this.flushingCallbacks) {
      await callback();
    }

    await this.flushDatabase();

    Route.flushPatterns();

    Facade.clearResolvedInstances();

    if (this.applicationCreated) {
      this.app.flush();
    }

    this.applicationCreated = false;
    this.booted = false;
  }

  /**
   * Disconnect a database the test resolved. RefreshDatabase flips
   * disconnectDatabaseOnFlush off to keep its shared connection alive.
   */
  protected async flushDatabase(): Promise<void> {
    if (!this.disconnectDatabaseOnFlush) {
      return;
    }

    if (!this.applicationCreated || !this.app.resolved('db')) {
      return;
    }

    try {
      await this.app.make<DatabaseManager>('db').disconnectAll();
    } catch {
      // A database that cannot be reached cannot matter to the next test
    }
  }

  // ==================== Runner integration ====================

  /**
   * Collect `test*` methods into a describe block, or register
   * beforeEach/afterEach for the vitest-style usage. Called from the
   * constructor during collection; silently skipped when there is no
   * runner global or construction happens inside a running test.
   */
  protected registerWithRunner(): void {
    const runner = globalThis as any;

    if (typeof runner.beforeEach !== 'function') {
      return;
    }

    const tests = this.testMethodNames();

    try {
      if (tests.length > 0 && typeof runner.describe === 'function' && typeof runner.it === 'function') {
        runner.describe((this as object).constructor.name, () => {
          runner.beforeEach(async () => {
            await this.setUp();
          });

          runner.afterEach(async () => {
            await this.tearDown();
          });

          for (const name of tests) {
            runner.it(prettifyTestName(name), async () => {
              await (this as any)[name]();
            });
          }
        });

        return;
      }

      runner.beforeEach(async () => {
        await this.setUp();
      });

      runner.afterEach(async () => {
        await this.tearDown();
      });
    } catch {
      // Constructed outside a collection context: the caller drives the
      // lifecycle manually.
    }
  }

  /**
   * The `test*` methods declared on the class and its subclasses -
   * stopping at the base case so its internals (like this method) never
   * look like tests
   */
  protected testMethodNames(): string[] {
    const names = new Set<string>();

    let proto: any = Object.getPrototypeOf(this);

    while (proto && proto !== Object.prototype && proto !== BaseTestCase.prototype) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key.startsWith('test') && key.length > 4 && typeof proto[key] === 'function') {
          names.add(key);
        }
      }

      proto = Object.getPrototypeOf(proto);
    }

    return [...names];
  }
}

/**
 * The composed test case: application lifecycle plus HTTP, database,
 * fake, exception-handling and time concerns. Extend it (optionally
 * through RefreshDatabase/DatabaseTransactions) for feature tests.
 */
export const TestCase = InteractsWithTime(
  InteractsWithFakes(InteractsWithExceptionHandling(InteractsWithDatabase(InteractsWithHttp(BaseTestCase))))
);

/**
 * Turn `test_it_creates_a_user` / `testItCreatesAUser` into
 * "it creates a user" for the runner's output
 */
function prettifyTestName(name: string): string {
  const stripped = name.replace(/^test[_]?/, '');

  const spaced = stripped
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
