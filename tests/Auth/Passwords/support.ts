/**
 * Shared helpers for the password-reset and email-verification suites: a
 * composed user model (HasAuthenticatable + HasPasswordReset +
 * HasVerifiedEmail over an in-memory attribute carrier, so the real
 * concerns are exercised without a database driver) plus an application
 * factory wiring sessions, hashing, auth, the password broker, cache,
 * rate limiting and a notification fake.
 *
 * The broker's token repository runs against an in-memory table by default
 * - registered through PasswordBrokerManager::extend(), which is also the
 * OCP seam custom drivers use. The SQLite suite swaps in the real
 * DatabaseServiceProvider path.
 */

import type { UserProviderModel } from '@/Auth/EnsembleUserProvider';
import type { PasswordResetTokenQuery } from '@/Auth/Passwords/DatabaseTokenRepository';
import type { PasswordResetDatabase, TokenRepositoryFactory } from '@/Auth/Passwords/PasswordBrokerManager';
import type { HashManager } from '@/Hashing/HashManager';
import type { NotificationFake } from '@/Support/Testing/Fakes/NotificationFake';
import { AUTH_DEFAULTS, AuthManager } from '@/Auth/AuthManager';
import { AuthServiceProvider } from '@/Auth/AuthServiceProvider';
import { HasAuthenticatable } from '@/Auth/Concerns/HasAuthenticatable';
import { HasPasswordReset } from '@/Auth/Concerns/HasPasswordReset';
import { HasVerifiedEmail } from '@/Auth/Concerns/HasVerifiedEmail';
import { DatabaseTokenRepository } from '@/Auth/Passwords/DatabaseTokenRepository';
import { PasswordBrokerManager } from '@/Auth/Passwords/PasswordBrokerManager';
import { PasswordResetServiceProvider } from '@/Auth/Passwords/PasswordResetServiceProvider';
import { CacheServiceProvider } from '@/Cache/CacheServiceProvider';
import { RateLimiterServiceProvider } from '@/Cache/RateLimiterServiceProvider';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { Kernel } from '@/Foundation/Http/Kernel';
import { HashServiceProvider } from '@/Hashing/HashServiceProvider';
import { Router } from '@/Routing/Router';
import { SessionServiceProvider } from '@/Session/SessionServiceProvider';
import { ArraySessionStore } from '@/Session/Stores/ArraySessionStore';
import { Facade } from '@/Support/Facade';
import { Notification } from '@/Testing';
import { TEST_OPTIONS, MemoryUser, testHasher } from '../support';

export { TEST_OPTIONS, testHasher };

/**
 * Minimal attribute carrier with in-memory persistence - the slice of the
 * Ensemble surface the auth concerns build on.
 */
class AttributeUser {
  static rows: Map<string, AttributeUser> = new Map();
  static nextId = 1;

  attributes: Record<string, any> = {};
  exists = false;
  timestamps = true;
  savedTimes = 0;

  constructor(attributes: Record<string, any> = {}) {
    this.attributes = { ...attributes };
  }

  getAttribute(key: string): any {
    return this.attributes[key];
  }

  setAttribute(key: string, value: any): this {
    this.attributes[key] = value;
    return this;
  }

  getKeyName(): string {
    return 'id';
  }

  async save(): Promise<boolean> {
    if (this.attributes.id === undefined || this.attributes.id === null) {
      this.attributes.id = AttributeUser.nextId++;
    }

    AttributeUser.rows.set(String(this.attributes.id), this);
    this.exists = true;
    this.savedTimes++;

    return true;
  }

  static query(): AttributeQuery {
    return new AttributeQuery();
  }

  static async find(identifier: any): Promise<AttributeUser | null> {
    return AttributeUser.rows.get(String(identifier)) ?? null;
  }

  static reset(): void {
    AttributeUser.rows.clear();
    AttributeUser.nextId = 1;
  }
}

/** Two-shape where() shorthand, like the provider's query contract */
class AttributeQuery {
  private wheres: Array<[string, any]> = [];

  where(column: string, operator?: any, value?: any): this {
    this.wheres.push([column, value === undefined ? operator : value]);
    return this;
  }

  async find(identifier: any): Promise<AttributeUser | null> {
    return AttributeQuery.matching([['id', identifier]])[0] ?? null;
  }

  async first(): Promise<AttributeUser | null> {
    return AttributeQuery.matching(this.wheres)[0] ?? null;
  }

  static matching(wheres: Array<[string, any]>): AttributeUser[] {
    return [...AttributeUser.rows.values()].filter((user) =>
      wheres.every(([column, value]) => String(user.getAttribute(column)) === String(value))
    );
  }
}

/**
 * The canonical test user: the three auth concerns composed over the
 * in-memory carrier, exactly the way a project composes them on Ensemble
 * (`HasVerifiedEmail(HasPasswordReset(HasAuthenticatable(Ensemble)))`).
 */
const ComposedUser = HasVerifiedEmail(HasPasswordReset(HasAuthenticatable(AttributeUser)));

export class TestUser extends ComposedUser {
  static async create(attributes: Record<string, any> = {}): Promise<TestUser> {
    const user = new TestUser(attributes);
    await user.save();
    return user;
  }

  static reset(): void {
    AttributeUser.reset();
  }

  /** All persisted users, for assertions */
  static all(): Map<string, AttributeUser> {
    return AttributeUser.rows;
  }
}

/** The provider model surface TestUser satisfies, for config typing */
export const TestUserModel = TestUser as unknown as UserProviderModel & typeof TestUser;

/**
 * An in-memory stand-in for the `password_reset_tokens` table, wired in as
 * a custom broker driver so broker/repo tests never need a database. The
 * PasswordReset suite's SQLite integration test proves the same flow
 * against the real builder.
 */
export class MemoryTokenTable {
  rows: Array<Record<string, any>> = [];

  private wheres: Array<[string, any]> = [];

  where(column: string, operator?: any, value?: any): MemoryTokenTable {
    this.wheres.push([column, value === undefined ? operator : value]);
    return this;
  }

  async first(): Promise<Record<string, any> | null> {
    const matching = this.matching();

    this.wheres = [];

    return matching[0] ?? null;
  }

  async insert(values: Record<string, any>): Promise<unknown> {
    this.rows.push({ ...values });
    this.wheres = [];

    return true;
  }

  async delete(): Promise<unknown> {
    const doomed = this.matching();
    this.rows = this.rows.filter((row) => !doomed.includes(row));
    this.wheres = [];

    return doomed.length;
  }

  /** Every stored row, for assertions on the hashed-token shape */
  all(): Array<Record<string, any>> {
    return [...this.rows];
  }

  private matching(): Array<Record<string, any>> {
    return this.rows.filter((row) => this.wheres.every(([column, value]) => String(row[column]) === String(value)));
  }
}

export interface PasswordAppContext {
  app: Application;
  router: Router;
  kernel: Kernel;
  auth: AuthManager;
  brokers: PasswordBrokerManager;
  notifications: NotificationFake;
  tokens: MemoryTokenTable;
  hasher: HashManager;
}

export interface PasswordAppOptions {
  /** Extra/overriding `auth` config entries */
  auth?: Record<string, any>;
  /** Broker `expire` minutes (default 60) */
  expire?: number;
  /** Broker `throttle` seconds (default 60) */
  throttle?: number;
  /** Verification config overrides */
  verification?: Record<string, any>;
  /** Database seam for the built-in 'database' broker driver */
  database?: PasswordResetDatabase;
}

/**
 * Boot the full password/verification stack: sessions, hashing, auth, the
 * password broker (with the in-memory token driver), cache + rate limiter,
 * and a notification fake. Returns the moving parts tests poke.
 */
export async function createPasswordApp(options: PasswordAppOptions = {}): Promise<PasswordAppContext> {
  TestUser.reset();
  MemoryUser.reset();
  ArraySessionStore.clear();

  const app = new Application('/test');
  const router = new Router(app);
  app.singleton('router', () => router);

  const tokens = new MemoryTokenTable();

  app.instance(
    'config',
    new Config({
      app: { key: 'test-key' },
      session: { driver: 'array' },
      cache: { default: 'array', stores: { array: { driver: 'array' } } },
      hashing: { driver: 'scrypt', scrypt: TEST_OPTIONS },
      auth: {
        defaults: AUTH_DEFAULTS.defaults,
        guards: AUTH_DEFAULTS.guards,
        providers: { users: { driver: 'ensemble', model: TestUserModel } },
        passwords: {
          users: {
            driver: 'memory',
            provider: 'users',
            expire: options.expire ?? 60,
            throttle: options.throttle ?? 60,
          },
        },
        verification: { provider: 'users', expire: 60, ...options.verification },
        ...options.auth,
      },
    })
  );

  app.register(SessionServiceProvider);
  app.register(HashServiceProvider);
  app.register(CacheServiceProvider);
  app.register(RateLimiterServiceProvider);
  app.register(AuthServiceProvider);
  app.register(PasswordResetServiceProvider);

  if (options.database) {
    // Fake DatabaseManager surface for the built-in 'database' broker driver
    app.instance('db', options.database as never);
  }

  await app.boot();

  const notifications = Notification.fake(app);

  const auth = app.make<AuthManager>('auth');
  const brokers = app.make<PasswordBrokerManager>('auth.password');

  // In-memory token storage through the manager's custom-driver seam
  const memoryDriver: TokenRepositoryFactory = (_name, config) =>
    new DatabaseTokenRepository({
      expire: (config.expire ?? 60) * 60,
      throttle: config.throttle ?? 60,
      hashKey: () => 'test-key',
      resolveTable: () => tokens as unknown as PasswordResetTokenQuery,
    });

  brokers.extend('memory', memoryDriver);

  Facade.setFacadeApplication(app);
  Facade.clearResolvedInstances();

  const kernel = new Kernel(app);
  const hasher = app.make<HashManager>('hash');

  return { app, router, kernel, auth, brokers, notifications, tokens, hasher };
}
