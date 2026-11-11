/**
 * SessionGuard - attempt/login/logout flows, session persistence across
 * requests, remember-me authentication and session ID regeneration.
 */

import { captureResponse, cookieValue, createRawRequest } from '@tests/Session/support';
import { beforeEach, describe, expect, it } from 'vitest';
import { EnsembleUserProvider } from '@/Auth/EnsembleUserProvider';
import { SessionGuard } from '@/Auth/SessionGuard';
import { UserNotFoundException } from '@/Auth/UserNotFoundException';
import { AuthenticationException } from '@/Foundation/Exceptions/AuthenticationException';
import { Request } from '@/Routing/Request';
import { Response } from '@/Routing/Response';
import { SessionManager } from '@/Session/SessionManager';
import { ArraySessionStore } from '@/Session/Stores/ArraySessionStore';
import { MemoryUser, testHasher } from './support';

const CREDENTIALS = { email: 'ada@example.com', password: 'secret' };

function buildProvider(): EnsembleUserProvider {
  return new EnsembleUserProvider({ model: MemoryUser as any }, testHasher());
}

describe('SessionGuard', () => {
  let sessions: SessionManager;
  let store: ReturnType<SessionManager['store']>;
  let guard: SessionGuard;
  let ada: MemoryUser;

  beforeEach(async () => {
    MemoryUser.reset();
    ArraySessionStore.clear();

    sessions = new SessionManager({ driver: 'array' });
    store = sessions.store();
    store.start();
    sessions.setCurrent(store);

    ada = await MemoryUser.create({
      email: 'ada@example.com',
      name: 'Ada',
      password: testHasher().make('secret'),
    });

    guard = new SessionGuard('session', buildProvider(), () => sessions.current());
  });

  /** Persist the running request's session and open the next one with its cookie */
  function nextRequest(previous: ReturnType<SessionManager['store']>): ReturnType<SessionManager['store']> {
    previous.save();

    const fresh = sessions.store(undefined, previous.getCookieValue());
    fresh.start();
    sessions.setCurrent(fresh);

    return fresh;
  }

  describe('attempt', () => {
    it('logs in a valid user and marks the session (AC)', async () => {
      expect(await guard.attempt(CREDENTIALS)).toBe(true);
      expect(await guard.check()).toBe(true);
      expect(await guard.guest()).toBe(false);

      const user = await guard.user();
      expect(user!.getAuthIdentifier()).toBe(ada.getAuthIdentifier());
      expect(store.get('login_session_user')).toBe(true);
      expect(store.get('login_session_user_login_id')).toBe(ada.getAuthIdentifier());
    });

    it('rejects invalid passwords with AuthenticationException (AC)', async () => {
      await expect(guard.attempt({ email: 'ada@example.com', password: 'wrong' })).rejects.toThrow(
        AuthenticationException
      );

      await expect(guard.attempt({ email: 'ada@example.com', password: 'wrong' })).rejects.toThrow(
        'These credentials do not match our records.'
      );

      expect(await guard.guest()).toBe(true);
    });

    it('rejects unknown accounts', async () => {
      await expect(guard.attempt({ email: 'grace@example.com', password: 'secret' })).rejects.toThrow(
        AuthenticationException
      );
    });

    it('regenerates the session ID on login, keeping the data (session fixation)', async () => {
      store.put('cart', '3 items');
      const guestId = store.getId();

      await guard.attempt(CREDENTIALS);

      expect(store.getId()).not.toBe(guestId);
      expect(store.get('cart')).toBe('3 items');
      expect(store.get('login_session_user')).toBe(true);
    });

    it('validates credentials without logging in', async () => {
      expect(await guard.validate(CREDENTIALS)).toBe(true);
      expect(await guard.validate({ email: 'ada@example.com', password: 'anything' })).toBe(true);
      expect(await guard.validate({ email: 'nobody@example.com', password: 'secret' })).toBe(false);
      expect(await guard.guest()).toBe(true);
    });
  });

  describe('session persistence', () => {
    it('the authenticated user survives a second request (AC)', async () => {
      await guard.attempt(CREDENTIALS);

      const authenticated = nextRequest(store);
      const secondGuard = new SessionGuard('session', buildProvider(), () => sessions.current());

      expect(await secondGuard.check()).toBe(true);
      const user = await secondGuard.user<MemoryUser>();
      expect(user!.getAttribute('email')).toBe('ada@example.com');
      expect(await secondGuard.id()).toBe(ada.getAuthIdentifier());
      expect(secondGuard.viaRemember()).toBe(false);
      expect(authenticated.get('login_session_user')).toBe(true);
    });

    it('a pre-login session ID no longer authenticates', async () => {
      const guestId = store.getId();
      await guard.attempt(CREDENTIALS);

      const sid = store.getCookieValue();
      nextRequest(store);

      const hijack = sessions.store(undefined, guestId);
      hijack.start();
      const stolen = new SessionGuard('session', buildProvider(), hijack);

      expect(await stolen.guest()).toBe(true);
      // ...while the regenerated ID does
      const real = sessions.store(undefined, sid);
      real.start();
      expect(await new SessionGuard('session', buildProvider(), real).check()).toBe(true);
    });
  });

  describe('login / loginUsingId', () => {
    it('login() authenticates a retrieved user directly', async () => {
      await guard.login(ada);

      expect(await guard.check()).toBe(true);
      expect(await guard.user()).toBe(ada);
      expect(store.get('login_session_user')).toBe(true);
    });

    it('login() with a numeric identifier resolves the user', async () => {
      await guard.login(ada.getAuthIdentifier());

      expect((await guard.user())!.getAuthIdentifier()).toBe(ada.getAuthIdentifier());
    });

    it('loginUsingId throws UserNotFoundException for unknown ids', async () => {
      await expect(guard.loginUsingId(404)).rejects.toThrow(UserNotFoundException);
    });

    it('login without a session throws a helpful error', async () => {
      const sessionless = new SessionGuard('sessionless', buildProvider(), () => null);

      await expect(sessionless.login(ada)).rejects.toThrow(/needs the session subsystem/);
    });

    it('a sessionless guard still reports guests', async () => {
      const sessionless = new SessionGuard('sessionless', buildProvider(), () => null);

      expect(await sessionless.guest()).toBe(true);
      expect(await sessionless.user()).toBeNull();
    });
  });

  describe('remember me', () => {
    it('attempt(..., true) stores a token and queues the recaller cookie', async () => {
      const captured = captureResponse();
      const res = new Response(captured.raw);
      guard.setResponse(res);

      await guard.attempt(CREDENTIALS, true);
      res.send('done');

      const token = MemoryUser.rows.get(String(ada.getAuthIdentifier()))!.getRememberToken();
      expect(token).toMatch(/^[a-zA-Z0-9]{60}$/);
      expect(cookieValue(captured.cookies, 'remember_session_recaller')).toBe(`${ada.getAuthIdentifier()}|${token}`);
    });

    it('authentication survives after the session cookie is removed (AC)', async () => {
      const captured = captureResponse();
      const res = new Response(captured.raw);
      guard.setResponse(res);

      await guard.attempt(CREDENTIALS, true);
      res.send('done');

      const recaller = cookieValue(captured.cookies, 'remember_session_recaller')!;

      // Second request: brand-new empty session, only the remember cookie
      const anonSession = sessions.store();
      anonSession.start();
      sessions.setCurrent(anonSession);

      const remembered = new Request(
        createRawRequest('GET', '/dashboard', { headers: { cookie: `remember_session_recaller=${recaller}` } })
      );
      const second = new SessionGuard('session', buildProvider(), () => sessions.current(), { request: remembered });

      const user = await second.user<MemoryUser>();
      expect(user!.getAttribute('email')).toBe('ada@example.com');
      expect(await second.check()).toBe(true);
      expect(second.viaRemember()).toBe(true);
      expect(await second.id()).toBe(ada.getAuthIdentifier());
      // Session was re-established from the recaller
      expect(anonSession.get('login_session_user')).toBe(true);
    });

    it('a forged recaller cookie cannot authenticate', async () => {
      const forged = new Request(
        createRawRequest('GET', '/dashboard', {
          headers: { cookie: `remember_session_recaller=${ada.getAuthIdentifier()}|attacker-token` },
        })
      );
      const second = new SessionGuard('session', buildProvider(), () => sessions.current(), { request: forged });

      expect(await second.user()).toBeNull();
      expect(second.viaRemember()).toBe(false);
    });

    it('login() reuses an existing remember token instead of rotating it', async () => {
      const captured = captureResponse();
      const res = new Response(captured.raw);
      const first = new SessionGuard('session', buildProvider(), () => sessions.current(), { response: res });

      await first.attempt(CREDENTIALS, true);
      const token = ada.getRememberToken();
      expect(token).toMatch(/^[a-zA-Z0-9]{60}$/);

      // A second remember login keeps the stored token
      await first.login(ada, true);
      res.send('done');

      expect(ada.getRememberToken()).toBe(token);
      expect(cookieValue(captured.cookies, 'remember_session_recaller')).toBe(`${ada.getAuthIdentifier()}|${token}`);
    });
  });

  describe('logout', () => {
    it('clears the session keys and the remember token (AC)', async () => {
      const { raw, cookies } = captureResponse();
      guard.setResponse(new Response(raw));

      await guard.attempt(CREDENTIALS, true);
      const authenticatedId = store.getId();

      await guard.logout();

      expect(await guard.guest()).toBe(true);
      expect(store.get('login_session_user')).toBeUndefined();
      expect(store.get('login_session_user_login_id')).toBeUndefined();
      expect(store.getId()).not.toBe(authenticatedId);

      // The stored remember token is gone, so the recaller cannot re-auth
      expect(MemoryUser.rows.get(String(ada.getAuthIdentifier()))!.getRememberToken()).toBeNull();
    });

    it('expires the recaller cookie on the response', async () => {
      const captured = captureResponse();
      const res = new Response(captured.raw);
      const request = new Request(
        createRawRequest('GET', '/', { headers: { cookie: 'remember_session_recaller=1|abc' } })
      );
      const active = new SessionGuard('session', buildProvider(), () => sessions.current(), {
        request,
        response: res,
      });

      await active.logout();
      res.send('done');

      const entry = captured.cookies.find((cookie) => cookie.startsWith('remember_session_recaller='));
      expect(entry).toBeDefined();
      expect(entry).toContain('Expires=Thu, 01 Jan 1970');
    });

    it('logging out a guest is harmless', async () => {
      await expect(guard.logout()).resolves.toBeUndefined();
    });
  });

  describe('id', () => {
    it('is null for guests and the identifier for users', async () => {
      expect(await guard.id()).toBeNull();

      await guard.attempt(CREDENTIALS);

      expect(await guard.id()).toBe(ada.getAuthIdentifier());
    });
  });
});
