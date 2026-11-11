/**
 * Shared helpers for the Auth suite: a cheap scrypt profile and an
 * in-memory user model that satisfies the ensemble provider's model
 * contract (static query()/find(), attribute access, save(), Authenticatable
 * methods) without touching a database driver.
 *
 * The SQLite-backed integration suite proves the same flows against real
 * Ensemble models; this fake keeps the guard/middleware behaviour testable
 * everywhere.
 */

import type { EnsembleUserInstance, UserProviderModel, UserProviderQuery } from '@/Auth/EnsembleUserProvider';
import { AUTH_DEFAULTS, AuthManager } from '@/Auth/AuthManager';
import { AuthServiceProvider } from '@/Auth/AuthServiceProvider';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { Kernel } from '@/Foundation/Http/Kernel';
import { HashManager } from '@/Hashing/HashManager';
import { HashServiceProvider } from '@/Hashing/HashServiceProvider';
import { Router } from '@/Routing/Router';
import { SessionManager } from '@/Session/SessionManager';
import { SessionServiceProvider } from '@/Session/SessionServiceProvider';

/** Cheap-but-real scrypt settings so the suite does not crawl */
export const TEST_OPTIONS = { cost: 1024, blockSize: 8, parallelization: 1, keyLength: 32, saltLength: 16 };

/** Hashing profile shared by the provider tests */
export function testHasher(): HashManager {
  return new HashManager({ driver: 'scrypt', scrypt: TEST_OPTIONS });
}

class MemoryQuery implements UserProviderQuery {
  private wheres: Array<[string, any]> = [];

  where(column: string, operator?: any, value?: any): this {
    // Same two-shape shorthand the real query builder supports
    this.wheres.push([column, value === undefined ? operator : value]);
    return this;
  }

  async find(identifier: any): Promise<MemoryUser | null> {
    return MemoryQuery.matching([['id', identifier]])[0] ?? null;
  }

  async first(): Promise<MemoryUser | null> {
    return MemoryQuery.matching(this.wheres)[0] ?? null;
  }

  static matching(wheres: Array<[string, any]>): MemoryUser[] {
    return [...MemoryUser.rows.values()].filter((user) =>
      wheres.every(([column, value]) => String(user.getAttribute(column)) === String(value))
    );
  }
}

/**
 * An in-memory user model shaped exactly like an Ensemble + HasAuthenticatable
 * pair: what EnsembleUserProvider queries against.
 */
export class MemoryUser implements EnsembleUserInstance {
  static rows: Map<string, MemoryUser> = new Map();
  static nextId = 1;

  attributes: Record<string, any> = {};
  exists = false;
  timestamps = true;
  savedTimes = 0;

  constructor(attributes: Record<string, any> = {}) {
    this.attributes = { ...attributes };
  }

  static query(): MemoryQuery {
    return new MemoryQuery();
  }

  static async find(identifier: any): Promise<MemoryUser | null> {
    return MemoryUser.rows.get(String(identifier)) ?? null;
  }

  static async create(attributes: Record<string, any>): Promise<MemoryUser> {
    const user = new MemoryUser(attributes);
    await user.save();
    return user;
  }

  static seed(attributes: Record<string, any>): MemoryUser {
    const user = new MemoryUser(attributes);
    user.stampId();
    MemoryUser.rows.set(String(user.attributes.id), user);
    user.exists = true;
    return user;
  }

  static reset(): void {
    MemoryUser.rows.clear();
    MemoryUser.nextId = 1;
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
    this.savedTimes++;
    this.stampId();
    MemoryUser.rows.set(String(this.attributes.id), this);
    this.exists = true;
    return true;
  }

  private stampId(): void {
    if (this.attributes.id === undefined || this.attributes.id === null) {
      this.attributes.id = MemoryUser.nextId++;
    }
  }

  // Authenticatable surface (identical to the HasAuthenticatable concern)

  getAuthIdentifierName(): string {
    return this.getKeyName();
  }

  getAuthIdentifier(): any {
    return this.getAttribute('id') ?? null;
  }

  getAuthPasswordName(): string {
    return 'password';
  }

  getAuthPassword(): string | null {
    const password = this.getAttribute('password');
    return password === undefined || password === null ? null : String(password);
  }

  getRememberToken(): string | null {
    const token = this.getAttribute('remember_token');
    return token === undefined || token === null ? null : String(token);
  }

  setRememberToken(token: string | null): void {
    this.setAttribute('remember_token', token);
  }

  getRememberTokenName(): string {
    return 'remember_token';
  }
}

/** The provider model surface MemoryUser satisfies, for config typing */
export const MemoryUserModel = MemoryUser as unknown as UserProviderModel;

/**
 * Boot an app wired with sessions, hashing and auth from config - the shape
 * a real application registers - and return its moving parts.
 */
export async function createAuthApp(
  authConfig: Record<string, any> = {},
  options: { sessionConfig?: Record<string, any> } = {}
): Promise<{ app: Application; router: Router; kernel: Kernel; sessions: SessionManager; auth: AuthManager }> {
  const app = new Application('/test');
  const router = new Router(app);
  app.singleton('router', () => router);

  app.instance(
    'config',
    new Config({
      app: { key: 'test-key' },
      session: { driver: 'array', ...options.sessionConfig },
      hashing: { driver: 'scrypt', scrypt: TEST_OPTIONS },
      auth: {
        defaults: AUTH_DEFAULTS.defaults,
        guards: AUTH_DEFAULTS.guards,
        providers: { users: { driver: 'ensemble', model: MemoryUserModel } },
        ...authConfig,
      },
    })
  );

  app.register(SessionServiceProvider);
  app.register(HashServiceProvider);
  app.register(AuthServiceProvider);
  await app.boot();

  const sessions = app.make<SessionManager>('session');
  const auth = app.make<AuthManager>('auth');
  const kernel = new Kernel(app);

  return { app, router, kernel, sessions, auth };
}
