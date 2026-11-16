/**
 * Shared shapes for the testing concerns (the "traits" of the testing
 * layer). Each concern is a class mixin over a base that provides this
 * surface - in practice `TestCase` - so request building, response
 * assertions, database assertions and time control stay separate classes
 * (SRP) while composing into one fluent test API.
 */

import type { Application } from '@/Foundation/Application';
import type { Kernel } from '@/Foundation/Http/Kernel';
import type { Router } from '@/Routing/Router';
import type { TestClient } from '@/Testing/TestClient';

/**
 * What every concern may rely on while mixed into a test case
 */
export interface TestApplication {
  /**
   * The application under test; set once setUp has booted it
   */
  app: Application;

  /**
   * The router the test's routes were declared on
   */
  router: Router;

  /**
   * The HTTP kernel requests are driven through
   */
  kernel: Kernel;

  /**
   * The test client wrapping the kernel
   */
  client: TestClient;

  /**
   * Boot the application (idempotent); concerns hook the same lifecycle
   */
  setUp(): Promise<void>;

  /**
   * Tear the application down and restore global state (idempotent)
   */
  tearDown(): Promise<void>;

  /**
   * Extension point concerns use to wire themselves into a freshly booted
   * application (client hooks, container swaps)
   */
  afterApplicationBoot(): void | Promise<void>;

  /**
   * Whether teardown disconnects the database the application resolved.
   * RefreshDatabase turns this off to keep its migrated in-memory schema
   * alive between tests.
   */
  disconnectDatabaseOnFlush: boolean;

  /**
   * Run work immediately before the application is flushed at teardown;
   * concerns use this to undo global side effects (fakes, time travel)
   */
  beforeFlushing(callback: () => void | Promise<void>): void;
}

/**
 * A test case class - concrete or abstract - satisfying the contract
 */
export type TestApplicationConstructor<T extends TestApplication = TestApplication> = abstract new (
  ...args: any[]
) => T;
