/**
 * Email verification
 *
 * Covers the verification stack over the HTTP kernel: the `verified`
 * middleware blocks unverified users (403 JSON / notice redirect) and lets
 * verified ones through; a signed verification URL marks the address
 * verified while tampered or expired links are rejected; the resend
 * endpoint notifies through VerifyEmail and is throttled; and the notice
 * endpoint answers "please verify" until the address carries a timestamp.
 */

import { handle } from '@tests/Session/support';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HasVerifiedEmail } from '@/Auth/Concerns/HasVerifiedEmail';
import { makeEnsureEmailIsVerified } from '@/Auth/Middleware/EnsureEmailIsVerified';
import { emailVerificationHash, VerifyEmail } from '@/Auth/Notifications/VerifyEmail';
import { registerEmailVerificationRoutes } from '@/Auth/Verification/routes';
import { StartSession } from '@/Session/Middleware/StartSession';
import { travel, travelBack } from '@/Testing';
import type { PasswordAppContext } from '../Passwords/support';
import { TestUser, createPasswordApp } from '../Passwords/support';

const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' };
const HTML_HEADERS = { accept: 'text/html' };

describe('Email verification', () => {
  let context: PasswordAppContext;
  let ada: TestUser;

  beforeEach(async () => {
    context = await createPasswordApp();
    context.kernel.use(StartSession);

    ada = await TestUser.create({ email: 'ada@example.com', name: 'Ada' });
  });

  afterEach(() => {
    travelBack();
  });

  function signedVerificationUrl(): string {
    return new VerifyEmail().verificationUrl(ada);
  }

  function get(path: string, headers: Record<string, string> = JSON_HEADERS): Promise<any> {
    return handle(context.kernel, 'GET', path, { headers });
  }

  function post(path: string, headers: Record<string, string> = JSON_HEADERS): Promise<any> {
    return handle(context.kernel, 'POST', path, { headers });
  }

  describe('HasVerifiedEmail concern', () => {
    it('reports the verified state from the email_verified_at column', async () => {
      expect(ada.hasVerifiedEmail()).toBe(false);
      expect(ada.getEmailForVerification()).toBe('ada@example.com');

      expect(await ada.markEmailAsVerified()).toBe(true);
      expect(ada.hasVerifiedEmail()).toBe(true);
      expect(new Date(String(ada.getAttribute('email_verified_at'))).getTime()).toBeCloseTo(Date.now(), -3);
    });

    it('marking an already verified address is a no-op', async () => {
      await ada.markEmailAsVerified();
      const saved = ada.savedTimes;

      await ada.markEmailAsVerified();
      expect(ada.savedTimes).toBe(saved);
    });

    it('composes cleanly over a bare attribute carrier', () => {
      class Plain {
        attributes: Record<string, any> = { email: 'ada@example.com' };
        saves = 0;

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
          this.saves++;
          return true;
        }
      }

      const Verifiable = HasVerifiedEmail(Plain);
      const user = new Verifiable();

      expect(user.hasVerifiedEmail()).toBe(false);
      expect(user.getEmailForVerification()).toBe('ada@example.com');
    });

    it('sends the VerifyEmail notification through the concern', async () => {
      await ada.sendEmailVerificationNotification();

      context.notifications.assertSentTo(ada, VerifyEmail);
    });
  });

  describe('VerifyEmail notification', () => {
    it('builds a temporary signed URL addressed by id and email hash', () => {
      registerEmailVerificationRoutes(context.router);

      const url = signedVerificationUrl();
      const id = String(ada.getAuthIdentifier());

      expect(url).toContain(`/email/verify/${id}/${emailVerificationHash('ada@example.com')}`);
      expect(url).toContain('signature=');
      expect(url).toContain('expires=');
    });

    it('the hash is sha1 of the address, like Laravel', () => {
      expect(emailVerificationHash('ada@example.com')).toHaveLength(40);
    });
  });

  describe('verified middleware', () => {
    beforeEach(() => {
      context.router.get('/secret', () => 'open').middleware('verified');
    });

    it('ships the alias through the AuthServiceProvider', () => {
      expect(context.router.getMiddleware().verified).toBeDefined();
    });

    it('blocks guests (401 JSON, login redirect for HTML)', async () => {
      const json = await get('/secret');
      expect(json.status).toBe(401);

      const html = await get('/secret', HTML_HEADERS);
      expect(html.status).toBe(302);
      expect(html.headers.Location).toBe('/login');
    });

    it('blocks unverified users (AC)', async () => {
      context.auth.actingAs(ada);

      const json = await get('/secret');
      expect(json.status).toBe(403);
      expect(JSON.parse(json.body)).toEqual({ message: 'Please confirm your email address to continue.' });

      const html = await get('/secret', HTML_HEADERS);
      expect(html.status).toBe(302);
      // No verification.notice route in this group: documented fallback
      expect(html.headers.Location).toBe('/email/verify');
    });

    it('lets verified users through (AC)', async () => {
      await ada.markEmailAsVerified();
      context.auth.actingAs(ada);

      const res = await get('/secret');

      expect(res.status).toBe(200);
      expect(res.body).toBe('open');
    });

    it('honours the guard option through the factory', async () => {
      context.auth.actingAs(ada);
      context.router
        .get('/api-secret', () => 'open')
        .middleware(makeEnsureEmailIsVerified(context.auth, { guard: 'token' }));

      const res = await get('/api-secret');
      expect(res.status).toBe(401);
    });

    it('explains when the user model lacks the contract', async () => {
      const stranger = {
        getAuthIdentifierName: () => 'id',
        getAuthIdentifier: () => 99,
        getAuthPasswordName: () => 'password',
        getAuthPassword: () => null,
        getRememberToken: () => null,
        setRememberToken: () => undefined,
        getRememberTokenName: () => 'remember_token',
      };

      context.auth.actingAs(stranger);

      const res = await get('/secret');
      expect(res.status).toBe(500);
    });
  });

  describe('verification.verify endpoint (signed URL)', () => {
    beforeEach(() => {
      registerEmailVerificationRoutes(context.router);
    });

    it('a signed URL marks the email verified and redirects (AC)', async () => {
      const url = signedVerificationUrl();

      const res = await get(url, HTML_HEADERS);

      expect(res.status).toBe(302);
      expect(res.headers.Location).toBe('/');
      expect(ada.hasVerifiedEmail()).toBe(true);

      const persisted = (await TestUser.find(ada.getAuthIdentifier())) as TestUser;
      expect(persisted.hasVerifiedEmail()).toBe(true);
    });

    it('answers JSON for API clients', async () => {
      const res = await get(signedVerificationUrl());

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ message: 'Your email address has been verified.' });
    });

    it('rejects a tampered id with a broken signature', async () => {
      const url = signedVerificationUrl().replace(`/${ada.getAuthIdentifier()}/`, '/999/');

      const res = await get(url);

      expect(res.status).toBe(403);
      expect(ada.hasVerifiedEmail()).toBe(false);
    });

    it('rejects an expired link', async () => {
      const url = signedVerificationUrl();

      travel(61 * 60);
      const res = await get(url);

      expect(res.status).toBe(403);
    });

    it('the request layer alone rejects a wrong hash and accepts the right one', async () => {
      // A registration without the signed middleware proves the
      // EmailVerificationRequest hash check is not just decoration.
      registerEmailVerificationRoutes(context.router, {
        noticePath: '/nv-notice',
        sendPath: '/nv-send',
        verifyPath: '/nv-verify/:id/:hash',
        verifyMiddleware: [],
      });

      const id = String(ada.getAuthIdentifier());

      const bad = await get(`/nv-verify/${id}/deadbeefdeadbeefdeadbeefdeadbeefdead`);
      expect(bad.status).toBe(403);
      expect(ada.hasVerifiedEmail()).toBe(false);

      const good = await get(`/nv-verify/${id}/${emailVerificationHash('ada@example.com')}`);
      expect(good.status).toBe(200);
      expect(ada.hasVerifiedEmail()).toBe(true);
    });

    it('a changed email address invalidates old links (hash layer)', async () => {
      registerEmailVerificationRoutes(context.router, {
        noticePath: '/hn-notice',
        sendPath: '/hn-send',
        verifyPath: '/hn-verify/:id/:hash',
        verifyMiddleware: [],
      });

      const url = `/hn-verify/${ada.getAuthIdentifier()}/${emailVerificationHash('ada@example.com')}`;
      const before = await get(url);
      expect(before.status).toBe(200);

      // Same hash, rotated address: the stored link must stop working
      ada.setAttribute('email', 'ada@new.example');
      const staleHash = `/hn-verify/${ada.getAuthIdentifier()}/${emailVerificationHash('ada@example.com')}`;
      const after = await get(staleHash);

      expect(after.status).toBe(403);
    });
  });

  describe('verification.send endpoint (resend + throttling)', () => {
    beforeEach(() => {
      registerEmailVerificationRoutes(context.router);
      context.auth.actingAs(ada);
    });

    it('mails a fresh verification notification (AC)', async () => {
      const res = await post('/email/verification-notification');

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).status).toBe('verification-link-sent');
      context.notifications.assertSentTo(ada, VerifyEmail);
    });

    it('blocks guests behind the auth middleware', async () => {
      context.auth.forgetActingAs();

      const res = await post('/email/verification-notification');
      expect(res.status).toBe(401);
    });

    it('throttles repeated resends (AC)', async () => {
      for (let attempt = 1; attempt <= 6; attempt++) {
        const res = await post('/email/verification-notification');
        expect(res.status).toBe(200);
      }

      const blocked = await post('/email/verification-notification');
      expect(blocked.status).toBe(429);

      // The decay window (minutes) unblocks it
      travel(61);
      const after = await post('/email/verification-notification');
      expect(after.status).toBe(200);
    });

    it('customises the throttle through the options', async () => {
      registerEmailVerificationRoutes(context.router, {
        noticePath: '/ct-notice',
        verifyPath: '/ct-verify/:id/:hash',
        sendPath: '/ct-send',
        resendThrottle: { max: 1 },
      });

      expect((await post('/ct-send')).status).toBe(200);
      expect((await post('/ct-send')).status).toBe(429);
    });

    it('does not mail verified users', async () => {
      await ada.markEmailAsVerified();

      const res = await post('/email/verification-notification');

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).message).toBe('Your email address is already verified.');
      context.notifications.assertNothingSent();
    });
  });

  describe('verification.notice endpoint', () => {
    beforeEach(() => {
      registerEmailVerificationRoutes(context.router);
      context.auth.actingAs(ada);
    });

    it('shows the notice to unverified users', async () => {
      const res = await get('/email/verify');

      expect(res.status).toBe(202);
      expect(JSON.parse(res.body)).toEqual({ message: 'Please verify your email address.' });
    });

    it('sends verified users on their way', async () => {
      await ada.markEmailAsVerified();

      const res = await get('/email/verify', HTML_HEADERS);

      expect(res.status).toBe(302);
      expect(res.headers.Location).toBe('/');
    });

    it('honours a configured redirect target', async () => {
      await ada.markEmailAsVerified();

      registerEmailVerificationRoutes(context.router, {
        noticePath: '/notice-2',
        verifyPath: '/r-verify/:id/:hash',
        sendPath: '/r-send',
        redirectTo: '/dashboard',
      });

      const res = await get('/notice-2', HTML_HEADERS);

      expect(res.headers.Location).toBe('/dashboard');
    });
  });
});
