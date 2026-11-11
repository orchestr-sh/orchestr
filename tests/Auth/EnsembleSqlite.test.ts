/**
 * Auth against a real Ensemble user model on an in-memory SQLite database
 *
 * Proves the EnsembleUserProvider + HasAuthenticatable pairing works exactly
 * like the in-memory doubles do: credential lookups hit the table, remember
 * tokens round-trip through saves, and the session guard restores users from
 * recaller cookies. Runs only when the better-sqlite3 driver is installed.
 */

import { captureResponse, cookieValue, createRawRequest } from '@tests/Session/support';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HasAuthenticatable } from '@/Auth/Concerns/HasAuthenticatable';
import { EnsembleUserProvider } from '@/Auth/EnsembleUserProvider';
import { SessionGuard } from '@/Auth/SessionGuard';
import { TokenGuard } from '@/Auth/TokenGuard';
import { DrizzleAdapter } from '@/Database/Adapters/DrizzleAdapter';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { Request } from '@/Routing/Request';
import { Response } from '@/Routing/Response';
import { SessionManager } from '@/Session/SessionManager';
import { ArraySessionStore } from '@/Session/Stores/ArraySessionStore';
import { testHasher } from './support';

async function hasBetterSqlite(): Promise<boolean> {
  try {
    await import('better-sqlite3');
    return true;
  } catch {
    return false;
  }
}

const WITH_BETTER_SQLITE = await hasBetterSqlite();

const SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT,
    api_token TEXT,
    remember_token TEXT,
    created_at TEXT,
    updated_at TEXT
  );
`;

/**
 * The canonical Laravel user shape: an Ensemble model plus the ported
 * Authenticatable trait.
 */
class User extends HasAuthenticatable(Ensemble) {
  static fillable: string[] = ['name', 'email', 'password', 'api_token', 'remember_token'];

  getTable(): string {
    return 'users';
  }
}

describe.skipIf(!WITH_BETTER_SQLITE)('Auth with an Ensemble model (better-sqlite3)', () => {
  let adapter: DrizzleAdapter;
  let sessions: SessionManager;

  beforeEach(async () => {
    ArraySessionStore.clear();
    sessions = new SessionManager({ driver: 'array' });

    adapter = new DrizzleAdapter({ driver: 'better-sqlite3', database: ':memory:' });
    await adapter.connect();

    for (const statement of SCHEMA.split(';').filter((s) => s.trim() !== '')) {
      await adapter.query(statement);
    }

    const manager = new DatabaseManager({
      default: 'main',
      connections: {
        main: { adapter: 'drizzle', driver: 'better-sqlite3', database: ':memory:' },
      },
    });
    manager.registerAdapter('drizzle', () => adapter);
    Ensemble.setConnectionResolver(manager);
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  function provider(): EnsembleUserProvider {
    return new EnsembleUserProvider({ model: User }, testHasher());
  }

  function guardFor(store: ReturnType<SessionManager['store']>, headers: Record<string, string> = {}): SessionGuard {
    return new SessionGuard('session', provider(), store, {
      request: new Request(createRawRequest('GET', '/', { headers })),
    });
  }

  /** Persist the running request's session and start the next one */
  function nextRequest(previous: ReturnType<SessionManager['store']>): ReturnType<SessionManager['store']> {
    previous.save();

    const fresh = sessions.store(undefined, previous.getCookieValue());
    fresh.start();

    return fresh;
  }

  async function seedUser(attributes: Record<string, any> = {}): Promise<User> {
    return (await User.create({
      name: 'Ada',
      email: 'ada@example.com',
      password: testHasher().make('secret'),
      ...attributes,
    })) as User;
  }

  describe('HasAuthenticatable concern', () => {
    it('exposes the Laravel user surface over model attributes', async () => {
      const user = await seedUser();

      expect(user.getAuthIdentifierName()).toBe('id');
      expect(user.getAuthIdentifier()).toBe(user.getKey());
      expect(user.getAuthPasswordName()).toBe('password');
      expect(user.getAuthPassword()).toContain('$scrypt$');
      expect(user.getRememberTokenName()).toBe('remember_token');
      expect(user.getRememberToken()).toBeNull();

      user.setRememberToken('abc');
      expect(user.getAttribute('remember_token')).toBe('abc');
    });
  });

  describe('provider against real rows', () => {
    it('retrieves and validates by credentials', async () => {
      const seeded = await seedUser();
      const found = await provider().retrieveByCredentials({ email: 'ada@example.com', password: 'secret' });

      expect(found).not.toBeNull();
      expect((found as User).getKey()).toBe(seeded.getKey());
      expect(await provider().retrieveByCredentials({ email: 'nobody@example.com', password: 'secret' })).toBeNull();
      expect(await provider().validateCredentials(found!, { password: 'secret' })).toBe(true);
      expect(await provider().validateCredentials(found!, { password: 'nope' })).toBe(false);
    });

    it('persists the remember token to the table without touching updated_at', async () => {
      const seeded = await seedUser();
      const before = (await User.find(seeded.getKey()))!;
      const updatedBefore = before.getAttribute('updated_at');

      await new Promise((resolve) => setTimeout(resolve, 5));
      await provider().updateRememberToken(seeded, 'persisted-token');

      const fresh = (await User.find(seeded.getKey()))!;
      expect(fresh.getRememberToken()).toBe('persisted-token');
      expect(fresh.getAttribute('updated_at')).toBe(updatedBefore);
    });

    it('reads users back by identifier and token pair', async () => {
      const seeded = await seedUser();
      await provider().updateRememberToken(seeded, 'round-trip');

      expect(await provider().retrieveById(seeded.getKey())).not.toBeNull();
      expect(await provider().retrieveByToken(seeded.getKey(), 'round-trip')).not.toBeNull();
      expect(await provider().retrieveByToken(seeded.getKey(), 'wrong')).toBeNull();
    });
  });

  describe('session guard over the database', () => {
    it('attempt -> session -> second request -> remember after session loss', async () => {
      const seeded = await seedUser();
      const store = sessions.store();
      store.start();
      const guard = guardFor(store);

      // AC 1: attempt logs the user in
      expect(await guard.attempt({ email: 'ada@example.com', password: 'secret' })).toBe(true);
      expect(await guard.check()).toBe(true);

      // AC 2: a second request resolves the user through the session
      const second = nextRequest(store);
      expect((await guardFor(second).user())!.getAuthIdentifier()).toBe(seeded.getKey());

      // A login with remember-me stores the token and queues the recaller
      const rememberStore = sessions.store();
      rememberStore.start();
      const rememberGuard = guardFor(rememberStore);
      const captured = captureResponse();
      const res = new Response(captured.raw);
      rememberGuard.setResponse(res);

      await rememberGuard.attempt({ email: 'ada@example.com', password: 'secret' }, true);
      res.send('done');

      const recaller = cookieValue(captured.cookies, 'remember_session_recaller')!;
      expect(recaller).toContain(String(seeded.getKey()));
      expect((await User.find(seeded.getKey()))!.getRememberToken()).toMatch(/^[a-zA-Z0-9]{60}$/);

      // AC 4: the recaller cookie authenticates even with a brand-new session
      const coldStore = sessions.store();
      coldStore.start();
      const coldGuard = guardFor(coldStore, { cookie: `remember_session_recaller=${recaller}` });

      const user = await coldGuard.user<User>();
      expect(user!.getAuthIdentifier()).toBe(seeded.getKey());
      expect(coldGuard.viaRemember()).toBe(true);

      // AC 3: logout clears the session keys and the stored token
      await coldGuard.logout();

      expect(await coldGuard.guest()).toBe(true);
      expect(coldStore.get('login_session_user')).toBeUndefined();
      expect((await User.find(seeded.getKey()))!.getRememberToken()).toBeNull();
    });
  });

  describe('token guard over the database', () => {
    it('bearer tokens resolve users from the table (AC)', async () => {
      await seedUser({ api_token: 'db-token-1' });

      const tokenProvider = new EnsembleUserProvider({ model: User, credentials: ['api_token'] }, testHasher());
      const guard = new TokenGuard(
        'token',
        tokenProvider,
        {},
        new Request(createRawRequest('GET', '/api/me', { headers: { authorization: 'Bearer db-token-1' } }))
      );

      expect((await guard.user<User>())!.getAttribute('email')).toBe('ada@example.com');

      const wrong = new TokenGuard(
        'token',
        tokenProvider,
        {},
        new Request(createRawRequest('GET', '/api/me', { headers: { authorization: 'Bearer nope' } }))
      );
      expect(await wrong.user()).toBeNull();
    });

    it('hashed bearer tokens resolve users stored as digests', async () => {
      const hashed = TokenGuard.hashToken('secret-token');
      await seedUser({ api_token: hashed });

      const tokenProvider = new EnsembleUserProvider({ model: User, credentials: ['api_token'] }, testHasher());
      const guard = new TokenGuard(
        'token',
        tokenProvider,
        { hash: true },
        new Request(createRawRequest('GET', '/api/me', { headers: { authorization: 'Bearer secret-token' } }))
      );

      expect((await guard.user<User>())!.getAttribute('email')).toBe('ada@example.com');
    });
  });
});
