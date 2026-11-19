/**
 * DatabaseTokenRepository against a real database
 *
 * The in-memory suites prove the broker semantics; this one proves the
 * production path: the repository's hashed tokens, expiry and throttle
 * running on the query builder over an in-memory SQLite `password_reset
 * _tokens` table - the exact layout the `password_reset_tokens` migration
 * ships. Runs only when the better-sqlite3 driver is installed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HasAuthenticatable } from '@/Auth/Concerns/HasAuthenticatable';
import { HasPasswordReset } from '@/Auth/Concerns/HasPasswordReset';
import { EnsembleUserProvider } from '@/Auth/EnsembleUserProvider';
import { DatabaseTokenRepository } from '@/Auth/Passwords/DatabaseTokenRepository';
import { PasswordBroker } from '@/Auth/Passwords/PasswordBroker';
import { DrizzleAdapter } from '@/Database/Adapters/DrizzleAdapter';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { Application } from '@/Foundation/Application';
import { Notification } from '@/Testing';
import { travel, travelBack } from '@/Testing';
import { TEST_OPTIONS, testHasher } from '../support';

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
    remember_token TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE password_reset_tokens (
    email TEXT PRIMARY KEY,
    token TEXT,
    created_at INTEGER
  );
`;

class User extends HasPasswordReset(HasAuthenticatable(Ensemble)) {
  static fillable: string[] = ['name', 'email', 'password', 'remember_token'];

  getTable(): string {
    return 'users';
  }
}

describe.skipIf(!WITH_BETTER_SQLITE)('DatabaseTokenRepository (better-sqlite3)', () => {
  let adapter: DrizzleAdapter;
  let tokens: DatabaseTokenRepository;
  let broker: PasswordBroker;
  let fakeNotifications: ReturnType<typeof Notification.fake>;

  beforeEach(async () => {
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

    tokens = new DatabaseTokenRepository({
      expire: 600, // ten minutes, in seconds (as the broker manager converts config.expire)
      throttle: 60,
      hashKey: () => 'test-key',
      resolveTable: () => manager.connection().table('password_reset_tokens'),
    });

    broker = new PasswordBroker(new EnsembleUserProvider({ model: User }, testHasher()), tokens, testHasher());

    // The reset notification routes through the application's notification
    // fake; an app instance (with nothing else registered) is enough.
    const app = new Application('/test-password-sqlite');
    fakeNotifications = Notification.fake(app);
  });

  afterEach(async () => {
    Notification.stop();
    travelBack();
    await adapter.disconnect();
  });

  async function seedUser(): Promise<User> {
    return (await User.create({
      name: 'Ada',
      email: 'ada@example.com',
      password: testHasher().make('secret'),
    })) as User;
  }

  async function storedRows(): Promise<Array<Record<string, any>>> {
    return (await adapter.query('SELECT email, token, created_at FROM password_reset_tokens')).rows;
  }

  it('stores the token hashed and validates the raw presentation (AC)', async () => {
    const user = await seedUser();

    const record = await tokens.create(user);

    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('ada@example.com');
    expect(rows[0].token).not.toBe(record.plainTextToken);
    expect(rows[0].token).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof rows[0].created_at).toBe('number');

    expect(await tokens.exists(user, record.plainTextToken)).toBe(true);
    expect(await tokens.exists(user, 'wrong-token')).toBe(false);
  });

  it('expires tokens and throttles re-creation (AC)', async () => {
    const user = await seedUser();

    const record = await tokens.create(user);

    // Inside the throttle window a second create is refused by the broker
    expect(await tokens.recentlyCreatedToken(user)).toBe(true);
    expect(await broker.sendResetLink({ email: 'ada@example.com' })).toBe(PasswordBroker.RESET_THROTTLED);

    travel(61);
    expect(await tokens.recentlyCreatedToken(user)).toBe(false);

    // Past the expiry window the mailed token is dead
    travel(600);
    expect(await tokens.exists(user, record.plainTextToken)).toBe(false);
  });

  it('resets the password, clears the token row and rejects reuse (AC)', async () => {
    const user = await seedUser();

    expect(await broker.sendResetLink({ email: 'ada@example.com' })).toBe(PasswordBroker.RESET_LINK_SENT);
    expect(fakeNotifications.sentNotifications).toHaveLength(1);

    const mailed = fakeNotifications.sentNotifications[0].notification as { token: string };

    expect(await broker.reset({ email: 'ada@example.com', token: mailed.token, password: 'brand-new' })).toBe(
      PasswordBroker.PASSWORD_RESET
    );

    const fresh = (await User.find(user.getKey()))!;
    expect(testHasher().check('brand-new', String(fresh.getAuthPassword()))).toBe(true);
    expect(fresh.getRememberToken()).toMatch(/^[A-Za-z0-9_-]{40}$/);

    expect(await storedRows()).toHaveLength(0);
    expect(await broker.reset({ email: 'ada@example.com', token: mailed.token, password: 'again' })).toBe(
      PasswordBroker.INVALID_TOKEN
    );
  });

  it('replacing a lost token: create after a reset sends a fresh link', async () => {
    const user = await seedUser();

    await broker.sendResetLink({ email: 'ada@example.com' });
    travel(61);

    expect(await broker.sendResetLink({ email: 'ada@example.com' })).toBe(PasswordBroker.RESET_LINK_SENT);

    const rows = await storedRows();
    expect(rows).toHaveLength(1); // the address's old token was replaced, not stacked
  });
});
