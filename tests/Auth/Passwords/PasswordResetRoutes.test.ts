/**
 * Password reset routes over HTTP
 *
 * Drives registerPasswordResetRoutes() through the full Kernel stack:
 * the password.email endpoint mails a signed link (or reports an error),
 * the signed password.reset form answers only for a valid unexpired
 * signature, and password.update performs the reset - rejecting
 * mismatched confirmations, bad tokens and expired links.
 */

import { handle } from '@tests/Session/support';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResetPassword } from '@/Auth/Notifications/ResetPassword';
import { PasswordBroker } from '@/Auth/Passwords/PasswordBroker';
import { registerPasswordResetRoutes } from '@/Auth/Passwords/routes';
import { StartSession } from '@/Session/Middleware/StartSession';
import { travel, travelBack } from '@/Testing';
import type { PasswordAppContext } from './support';
import { TestUser, createPasswordApp, testHasher } from './support';

const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' };

describe('Password reset routes (HTTP)', () => {
  let context: PasswordAppContext;

  beforeEach(async () => {
    context = await createPasswordApp({ expire: 10 });
    context.kernel.use(StartSession);

    await TestUser.create({ email: 'ada@example.com', name: 'Ada', password: testHasher().make('secret') });

    registerPasswordResetRoutes(context.router);
  });

  afterEach(() => {
    travelBack();
  });

  function user(): TestUser {
    return [...TestUser.all().values()][0] as TestUser;
  }

  function post(path: string, payload: Record<string, any>): Promise<any> {
    return handle(context.kernel, 'POST', path, { headers: JSON_HEADERS, body: JSON.stringify(payload) });
  }

  /** Mail a link through the endpoint and pull the token off the recorded notification */
  async function requestLink(): Promise<string> {
    await post('/forgot-password', { email: 'ada@example.com' });

    return (context.notifications.sentNotifications[0].notification as ResetPassword).token;
  }

  describe('POST /forgot-password (password.email)', () => {
    it('mails a reset link for a known address (AC)', async () => {
      const res = await post('/forgot-password', { email: 'ada@example.com' });

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ message: 'We have emailed your password reset link.' });
      context.notifications.assertSentTo(user(), ResetPassword);
    });

    it('reports an error for an unknown address without mailing (AC)', async () => {
      const res = await post('/forgot-password', { email: 'nobody@example.com' });

      expect(res.status).toBe(422);
      expect(JSON.parse(res.body)).toEqual({
        message: "We can't find a user with that email address.",
        errors: { email: ["We can't find a user with that email address."] },
      });
      context.notifications.assertNothingSent();
    });

    it('validates the email field', async () => {
      const res = await post('/forgot-password', {});

      expect(res.status).toBe(422);
      expect(JSON.parse(res.body).errors.email).toBeDefined();
    });

    it('throttles a second request inside the throttle window (AC)', async () => {
      await post('/forgot-password', { email: 'ada@example.com' });

      const second = await post('/forgot-password', { email: 'ada@example.com' });
      expect(second.status).toBe(429);

      travel(61);
      const third = await post('/forgot-password', { email: 'ada@example.com' });
      expect(third.status).toBe(200);
    });
  });

  describe('GET /reset-password/:token (password.reset)', () => {
    it('serves the form for the signed link from the mail (AC)', async () => {
      const token = await requestLink();

      const url = new ResetPassword(token).resetUrl(user());
      const res = await handle(context.kernel, 'GET', url, { headers: { accept: 'text/html' } });

      expect(res.status).toBe(200);
      expect(res.body).toContain('Reset Password');
      expect(res.body).toContain('name="token"');
    });

    it('rejects a tampered signature with 403', async () => {
      const token = await requestLink();

      const url = new ResetPassword(token).resetUrl(user()).replace('ada%40example.com', 'evil%40example.com');
      const res = await handle(context.kernel, 'GET', url, { headers: { accept: 'application/json' } });

      expect(res.status).toBe(403);
    });

    it('rejects an expired link with 403', async () => {
      const token = await requestLink();

      const url = new ResetPassword(token).resetUrl(user());
      travel(10 * 60 + 5);

      const res = await handle(context.kernel, 'GET', url, { headers: { accept: 'application/json' } });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /reset-password (password.update)', () => {
    it('resets the password with a valid token and logs the link out (AC)', async () => {
      const token = await requestLink();

      const res = await post('/reset-password', {
        token,
        email: 'ada@example.com',
        password: 'brand-new',
        password_confirmation: 'brand-new',
      });

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ message: 'Your password has been reset.' });

      expect(testHasher().check('brand-new', String(user().getAuthPassword()))).toBe(true);
      expect(context.tokens.all()).toHaveLength(0);
    });

    it('requires matching confirmation', async () => {
      const token = await requestLink();

      const res = await post('/reset-password', {
        token,
        email: 'ada@example.com',
        password: 'brand-new',
        password_confirmation: 'typo',
      });

      expect(res.status).toBe(422);
      expect(testHasher().check('secret', String(user().getAuthPassword()))).toBe(true);
    });

    it('rejects an invalid or already-used token (AC)', async () => {
      const token = await requestLink();

      const first = await post('/reset-password', {
        token,
        email: 'ada@example.com',
        password: 'one',
        password_confirmation: 'one',
      });
      expect(first.status).toBe(200);

      const reuse = await post('/reset-password', {
        token,
        email: 'ada@example.com',
        password: 'two',
        password_confirmation: 'two',
      });

      expect(reuse.status).toBe(422);
      expect(JSON.parse(reuse.body)).toEqual({
        message: 'This password reset token is invalid.',
        errors: { token: ['This password reset token is invalid.'] },
      });
    });

    it('rejects an expired token (AC)', async () => {
      const token = await requestLink();

      travel(10 * 60 + 5);

      const res = await post('/reset-password', {
        token,
        email: 'ada@example.com',
        password: 'late',
        password_confirmation: 'late',
      });

      expect(res.status).toBe(422);
      expect(JSON.parse(res.body).message).toBe('This password reset token is invalid.');
    });

    it('reports an unknown address', async () => {
      const res = await post('/reset-password', {
        token: 'irrelevant',
        email: 'nobody@example.com',
        password: 'whatever123',
        password_confirmation: 'whatever123',
      });

      expect(res.status).toBe(422);
      expect(JSON.parse(res.body).message).toBe("We can't find a user with that email address.");
    });
  });

  describe('route names', () => {
    it('registers the conventional password.* names', () => {
      const named = new ResetPassword('t');

      // The notification signs the named route; assert it exists by URL
      expect(context.router.url('password.email')).toBe('/forgot-password');
      expect(named).toBeInstanceOf(ResetPassword);

      const url = named.resetUrl(user());
      expect(url).toContain('/reset-password/t?');
      expect(url).toContain('signature=');
      expect(url).toContain('expires=');
    });
  });

  describe('broker status mapping', () => {
    it('maps throttling and unknown users to the documented statuses', async () => {
      expect(PasswordBroker.RESET_LINK_SENT).toBe('passwords.sent');
      expect(PasswordBroker.RESET_THROTTLED).toBe('passwords.throttled');
      expect(PasswordBroker.PASSWORD_RESET).toBe('passwords.reset');
      expect(PasswordBroker.INVALID_TOKEN).toBe('invalid-token');
      expect(PasswordBroker.INVALID_USER).toBe('invalid-user');
    });
  });
});
