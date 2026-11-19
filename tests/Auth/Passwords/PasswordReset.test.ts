/**
 * Password reset broker + DatabaseTokenRepository
 *
 * Covers the AC surface at the service layer: reset link generation mails
 * the CanResetPassword notification for existing users and reports an
 * error for unknown ones; tokens are stored hashed, validate, expire, are
 * single-use (invalidated by a successful reset) and throttled; and a
 * valid reset rehashes the password and rotates the remember token.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PasswordResetTokenQuery } from '@/Auth/Passwords/DatabaseTokenRepository';
import { ResetPassword } from '@/Auth/Notifications/ResetPassword';
import { PasswordBroker } from '@/Auth/Passwords/PasswordBroker';
import { Password } from '@/Facades/Password';
import { password } from '@/Support/helpers';
import { travel, travelBack } from '@/Testing';
import type { PasswordAppContext } from './support';
import { MemoryTokenTable, TestUser, createPasswordApp, testHasher } from './support';

const CREDENTIALS = { email: 'ada@example.com', password: 'secret' };

describe('Password reset broker', () => {
  let context: PasswordAppContext;

  beforeEach(async () => {
    context = await createPasswordApp();

    await TestUser.create({ ...CREDENTIALS, password: testHasher().make('secret') });
  });

  afterEach(() => {
    travelBack();
  });

  function broker(): PasswordBroker {
    return context.brokers.broker();
  }

  /** The user row, re-read from the in-memory store */
  function freshUser(): TestUser {
    return [...TestUser.all().values()][0] as TestUser;
  }

  /** Mail a link and hand back the raw token */
  async function mailedToken(): Promise<string> {
    await broker().sendResetLink({ email: CREDENTIALS.email });
    return (context.notifications.sentNotifications[0].notification as ResetPassword).token;
  }

  describe('sendResetLink', () => {
    it('mails a reset link for an existing user (AC)', async () => {
      const status = await broker().sendResetLink({ email: CREDENTIALS.email });

      expect(status).toBe(PasswordBroker.RESET_LINK_SENT);
      context.notifications.assertSentTo(freshUser(), ResetPassword);
    });

    it('stores only a hashed token and hands the plain text to the notification (AC)', async () => {
      const status = await broker().sendResetLink({ email: CREDENTIALS.email });

      expect(status).toBe(PasswordBroker.RESET_LINK_SENT);

      const stored = context.tokens.all();
      expect(stored).toHaveLength(1);
      expect(stored[0].email).toBe(CREDENTIALS.email);

      const mailed = context.notifications.sentNotifications[0].notification as ResetPassword;
      expect(mailed.token).not.toBe(stored[0].token);
      expect(stored[0].token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('reports an error for an unknown user and mails nothing (AC)', async () => {
      const status = await broker().sendResetLink({ email: 'nobody@example.com' });

      expect(status).toBe(PasswordBroker.INVALID_USER);
      context.notifications.assertNothingSent();
      expect(context.tokens.all()).toHaveLength(0);
    });

    it('throttles a second link inside the throttle window (AC)', async () => {
      await broker().sendResetLink({ email: CREDENTIALS.email });

      const second = await broker().sendResetLink({ email: CREDENTIALS.email });
      expect(second).toBe(PasswordBroker.RESET_THROTTLED);
      context.notifications.assertSentTimes(ResetPassword, 1);

      // Past the 60s throttle window a new link goes out
      travel(61);
      expect(await broker().sendResetLink({ email: CREDENTIALS.email })).toBe(PasswordBroker.RESET_LINK_SENT);
      expect(context.tokens.all()).toHaveLength(1);
    });

    it('resolves through the password() helper and the default broker', async () => {
      expect(await password().sendResetLink({ email: CREDENTIALS.email })).toBe(PasswordBroker.RESET_LINK_SENT);
      expect(await password('users').validateToken({ email: CREDENTIALS.email, token: 'nope' })).toBe(
        PasswordBroker.INVALID_TOKEN
      );
    });
  });

  describe('validateToken', () => {
    it('accepts the freshly mailed token', async () => {
      await broker().sendResetLink({ email: CREDENTIALS.email });

      const mailed = context.notifications.sentNotifications[0].notification as ResetPassword;

      expect(await broker().validateToken({ email: CREDENTIALS.email, token: mailed.token })).toBe(true);
    });

    it('rejects unknown users, wrong tokens and missing tokens', async () => {
      expect(await broker().validateToken({ email: 'nobody@example.com', token: 'whatever' })).toBe(
        PasswordBroker.INVALID_USER
      );

      await broker().sendResetLink({ email: CREDENTIALS.email });
      expect(await broker().validateToken({ email: CREDENTIALS.email, token: 'wrong' })).toBe(
        PasswordBroker.INVALID_TOKEN
      );
      expect(await broker().validateToken({ email: CREDENTIALS.email })).toBe(PasswordBroker.INVALID_TOKEN);
    });

    it('rejects an expired token (AC)', async () => {
      const app = await createPasswordApp({ expire: 10 });
      await TestUser.create({ ...CREDENTIALS, password: testHasher().make('secret') });

      await app.brokers.broker().sendResetLink({ email: CREDENTIALS.email });
      const mailed = app.notifications.sentNotifications[0].notification as ResetPassword;

      // Within the window: valid
      expect(await app.brokers.broker().validateToken({ email: CREDENTIALS.email, token: mailed.token })).toBe(true);

      travel(11 * 60);
      expect(await app.brokers.broker().validateToken({ email: CREDENTIALS.email, token: mailed.token })).toBe(
        PasswordBroker.INVALID_TOKEN
      );
    });

    it('rejects a tampered (case-flipped) token presentation', async () => {
      await broker().sendResetLink({ email: CREDENTIALS.email });
      const mailed = context.notifications.sentNotifications[0].notification as ResetPassword;

      const flipped = mailed.token.slice(0, -1) + (mailed.token.endsWith('a') ? 'b' : 'a');

      expect(await broker().validateToken({ email: CREDENTIALS.email, token: flipped })).toBe(
        PasswordBroker.INVALID_TOKEN
      );
    });
  });

  describe('reset', () => {
    it('resets with a valid token, hashes the new password and invalidates the token (AC)', async () => {
      const token = await mailedToken();

      const status = await broker().reset({ email: CREDENTIALS.email, token, password: 'brand-new' });

      expect(status).toBe(PasswordBroker.PASSWORD_RESET);

      const user = freshUser();
      expect(user.getAttribute('password')).not.toBe('brand-new');
      expect(testHasher().check('brand-new', String(user.getAttribute('password')))).toBe(true);
      expect(user.getRememberToken()).toMatch(/^[A-Za-z0-9_-]{40}$/);

      // The stored token is gone: the same link cannot be reused (AC)
      expect(context.tokens.all()).toHaveLength(0);
      expect(await broker().reset({ email: CREDENTIALS.email, token, password: 'again' })).toBe(
        PasswordBroker.INVALID_TOKEN
      );
    });

    it('runs the optional reset callback before persisting', async () => {
      const token = await mailedToken();
      const seen: Array<[string, string]> = [];

      const status = await broker().reset(
        { email: CREDENTIALS.email, token, password: 'from-callback' },
        (user, pw) => {
          seen.push([String(user.getAuthIdentifier()), pw]);
        }
      );

      expect(status).toBe(PasswordBroker.PASSWORD_RESET);
      expect(seen).toEqual([[String(freshUser().getAuthIdentifier()), 'from-callback']]);
    });

    it('rejects an expired or reused token without touching the password (AC)', async () => {
      const app = await createPasswordApp({ expire: 10 });
      await TestUser.create({ ...CREDENTIALS, password: testHasher().make('secret') });

      await app.brokers.broker().sendResetLink({ email: CREDENTIALS.email });
      const token = (app.notifications.sentNotifications[0].notification as ResetPassword).token;

      travel(10 * 60 + 61);

      expect(await app.brokers.broker().reset({ email: CREDENTIALS.email, token, password: 'too-late' })).toBe(
        PasswordBroker.INVALID_TOKEN
      );
      expect(testHasher().check('secret', String(freshUser().getAuthPassword()))).toBe(true);
    });

    it('rejects unknown email or missing token', async () => {
      expect(await broker().reset({ email: 'nobody@example.com', token: 'x', password: 'y' })).toBe(
        PasswordBroker.INVALID_USER
      );

      // A known address without a token is a bad link, not a bad account
      expect(await broker().reset({ email: CREDENTIALS.email, password: 'y' })).toBe(PasswordBroker.INVALID_TOKEN);
    });
  });

  describe('deleteToken', () => {
    it('invalidates a mailed token without resetting anything', async () => {
      await broker().sendResetLink({ email: CREDENTIALS.email });
      const token = (context.notifications.sentNotifications[0].notification as ResetPassword).token;

      await broker().deleteToken({ email: CREDENTIALS.email });

      expect(await broker().validateToken({ email: CREDENTIALS.email, token })).toBe(PasswordBroker.INVALID_TOKEN);
      expect(testHasher().check('secret', String(freshUser().getAuthPassword()))).toBe(true);
    });
  });

  describe('provider integration', () => {
    it('the new password validates through the user provider afterwards', async () => {
      const token = await mailedToken();
      await broker().reset({ email: CREDENTIALS.email, token, password: 'rotated' });

      const provider = context.auth.provider('users');

      expect(await provider.validateCredentials(freshUser(), { password: 'rotated' })).toBe(true);
      expect(await provider.validateCredentials(freshUser(), { password: 'secret' })).toBe(false);
    });
  });

  describe('manager configuration', () => {
    it('names an unconfigured broker loudly', () => {
      expect(() => context.brokers.broker('admins')).toThrow(/Password broker \[admins\] is not defined/);
    });

    it('an unknown driver suggests Password.extend()', async () => {
      const app = await createPasswordApp({ auth: { passwords: { users: { driver: 'dynamo' } } } });

      expect(() => app.brokers.broker()).toThrow(/Password broker driver \[dynamo\] is not defined/);
    });
  });

  describe('Password facade', () => {
    it('forwards the broker API to the default broker (AC)', async () => {
      expect(await Password.sendResetLink({ email: CREDENTIALS.email })).toBe(PasswordBroker.RESET_LINK_SENT);

      const mailed = context.notifications.sentNotifications[0].notification as ResetPassword;
      expect(await Password.validateToken({ email: CREDENTIALS.email, token: mailed.token })).toBe(true);

      await Password.deleteToken({ email: CREDENTIALS.email });
      expect(await Password.validateToken({ email: CREDENTIALS.email, token: mailed.token })).toBe(
        PasswordBroker.INVALID_TOKEN
      );
    });
  });

  describe('the default database driver', () => {
    it('reaches the configured connection/table through the database seam', async () => {
      const tokens = new MemoryTokenTable();
      const seen: Array<[string | undefined, string | undefined]> = [];

      const app = await createPasswordApp({
        auth: {
          passwords: {
            users: { provider: 'users', table: 'pr_tokens', connection: 'secondary', expire: 30, throttle: 5 },
          },
        },
        database: {
          connection: (name?: string) => ({
            table: (tableName?: string) => {
              seen.push([name, tableName]);
              return tokens as unknown as PasswordResetTokenQuery;
            },
          }),
        },
      });

      await TestUser.create({ email: 'ada@example.com', password: testHasher().make('secret') });

      // driver omitted => the built-in 'database' path, wired through the
      // manager's DatabaseManager seam
      expect(await app.brokers.sendResetLink({ email: 'ada@example.com' })).toBe(PasswordBroker.RESET_LINK_SENT);
      expect(seen[0]).toEqual(['secondary', 'pr_tokens']);
      expect(tokens.all()[0].token).toMatch(/^[0-9a-f]{64}$/);

      const mailed = app.notifications.sentNotifications[0].notification as ResetPassword;
      expect(mailed.token).toMatch(/^[A-Za-z0-9_-]{40}$/);
      expect(mailed.token).not.toBe(tokens.all()[0].token);

      // config.expire minutes -> seconds: 30 minutes of validity
      expect(await app.brokers.validateToken({ email: 'ada@example.com', token: mailed.token })).toBe(true);
      expect(await app.brokers.broker().validateToken({ email: 'ada@example.com', token: mailed.token })).toBe(true);

      travel(31 * 60);
      expect(await app.brokers.validateToken({ email: 'ada@example.com', token: mailed.token })).toBe(
        PasswordBroker.INVALID_TOKEN
      );
    });
  });
});
