/**
 * Auth middleware - 'auth' blocks guests with 401 JSON or a login redirect,
 * 'guest' bounces authenticated users home, and the full login -> protected
 * -> remember -> logout round trip runs through the HTTP kernel.
 */

import { cookieValue, handle } from '@tests/Session/support';
import { beforeEach, describe, expect, it } from 'vitest';
import { Authenticate, makeAuthenticate } from '@/Auth/Middleware/Authenticate';
import { makeRedirectIfAuthenticated, RedirectIfAuthenticated } from '@/Auth/Middleware/RedirectIfAuthenticated';
import { Auth } from '@/Facades/Auth';
import { Application } from '@/Foundation/Application';
import { StartSession } from '@/Session/Middleware/StartSession';
import { ArraySessionStore } from '@/Session/Stores/ArraySessionStore';
import { Facade } from '@/Support/Facade';
import { auth } from '@/Support/helpers';
import { createAuthApp, MemoryUser, MemoryUserModel, testHasher } from './support';

const CREDENTIALS = { email: 'ada@example.com', password: 'secret' };

describe('Auth middleware', () => {
  let context: Awaited<ReturnType<typeof createAuthApp>>;

  beforeEach(async () => {
    MemoryUser.reset();
    ArraySessionStore.clear();

    context = await createAuthApp({ providers: { users: { driver: 'ensemble', model: MemoryUserModel } } });
    Facade.setFacadeApplication(context.app);
    Facade.clearResolvedInstances();

    const { router, kernel } = context;

    kernel.use(StartSession);

    await MemoryUser.create({ email: 'ada@example.com', name: 'Ada', password: testHasher().make('secret') });

    router.post('/login', async (req: any, res: any) => {
      await Auth.forRequest(req, res).attempt(req.only(['email', 'password']), req.input('remember') === '1');

      return { ok: true };
    });

    router
      .get('/me', async (req: any) => {
        const user = await req.user();

        return { email: user.getAttribute('email'), viaRemember: req.auth().viaRemember() };
      })
      .middleware('auth');

    router
      .post('/logout', async (req: any) => {
        // The auth middleware already bound the request/response; the
        // request hands back the very guard that authenticated it
        await req.auth().logout();

        return { ok: true };
      })
      .middleware('auth');

    router.get('/login-form', () => 'login form').middleware('guest');

    router
      .get('/api/me', async (req: any) => {
        const user = await req.user('token');

        return { email: user.getAttribute('email') };
      })
      .middleware(makeAuthenticate(context.auth, { guards: ['token'] }));
  });

  /** Log in through HTTP and return the session cookie value */
  async function login(): Promise<string> {
    const res = await handle(context.kernel, 'POST', '/login', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CREDENTIALS),
    });

    expect(res.status).toBe(200);

    return cookieValue(res.cookies, 'orchestr_session')!;
  }

  describe('login flow', () => {
    it('attempt logs in a valid user and the session survives the next request (AC)', async () => {
      const sid = await login();

      expect(sid).toMatch(/^[a-zA-Z0-9]{40}$/);

      const me = await handle(context.kernel, 'GET', '/me', { headers: { cookie: `orchestr_session=${sid}` } });

      expect(me.status).toBe(200);
      expect(JSON.parse(me.body)).toEqual({ email: 'ada@example.com', viaRemember: false });
    });

    it('rejects invalid credentials with a 401 response (AC)', async () => {
      const res = await handle(context.kernel, 'POST', '/login', {
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email: 'ada@example.com', password: 'wrong' }),
      });

      expect(res.status).toBe(401);
      expect(JSON.parse(res.body)).toEqual({ message: 'These credentials do not match our records.' });
    });
  });

  describe('auth middleware', () => {
    it('answers 401 JSON to requests that expect JSON (AC)', async () => {
      const res = await handle(context.kernel, 'GET', '/me', { headers: { accept: 'application/json' } });

      expect(res.status).toBe(401);
      expect(JSON.parse(res.body)).toEqual({ message: 'Unauthenticated.' });
    });

    it('redirects HTML guests to /login (AC)', async () => {
      const res = await handle(context.kernel, 'GET', '/me', { headers: { accept: 'text/html' } });

      expect(res.status).toBe(302);
      expect(res.headers.Location).toBe('/login');
    });

    it('prefers the named login route when the app defines one', async () => {
      context.router.name(
        'login',
        context.router.get('/signin', () => 'login')
      );

      const res = await handle(context.kernel, 'GET', '/me', { headers: { accept: 'text/html' } });

      expect(res.status).toBe(302);
      expect(res.headers.Location).toBe('/signin');
    });

    it('honours a redirect override on the factory', async () => {
      context.router.get('/secure', () => 'ok').middleware(makeAuthenticate(context.auth, { redirectTo: '/signin' }));

      const res = await handle(context.kernel, 'GET', '/secure', { headers: { accept: 'text/html' } });

      expect(res.status).toBe(302);
      expect(res.headers.Location).toBe('/signin');
    });
  });

  describe('remember me over HTTP', () => {
    it('authenticates the next request after the session cookie is removed (AC)', async () => {
      const res = await handle(context.kernel, 'POST', '/login', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...CREDENTIALS, remember: '1' }),
      });

      const recaller = cookieValue(res.cookies, 'remember_session_recaller')!;
      expect(recaller).toMatch(/^\d+\|[a-zA-Z0-9]{60}$/);

      // Only the remember cookie travels; no session cookie
      const me = await handle(context.kernel, 'GET', '/me', {
        headers: { cookie: `remember_session_recaller=${recaller}` },
      });

      expect(me.status).toBe(200);
      expect(JSON.parse(me.body)).toEqual({ email: 'ada@example.com', viaRemember: true });

      // ...and the new session persists without the recaller
      const sid = cookieValue(me.cookies, 'orchestr_session')!;
      const again = await handle(context.kernel, 'GET', '/me', { headers: { cookie: `orchestr_session=${sid}` } });
      expect(JSON.parse(again.body)).toEqual({ email: 'ada@example.com', viaRemember: false });
    });

    it('logout clears the session and remember token, and expires the cookie (AC)', async () => {
      const loginRes = await handle(context.kernel, 'POST', '/login', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...CREDENTIALS, remember: '1' }),
      });

      const sid = cookieValue(loginRes.cookies, 'orchestr_session')!;
      const recaller = cookieValue(loginRes.cookies, 'remember_session_recaller')!;

      const logout = await handle(context.kernel, 'POST', '/logout', {
        headers: { cookie: `orchestr_session=${sid}; remember_session_recaller=${recaller}` },
      });

      expect(logout.status).toBe(200);

      // The recaller cookie is expired on the way out...
      const expired = logout.cookies.find((cookie) => cookie.startsWith('remember_session_recaller='));
      expect(expired).toBeDefined();
      expect(expired).toContain('Expires=Thu, 01 Jan 1970');

      // ...the stored remember token is gone, and neither cookie authenticates
      expect(MemoryUser.rows.get('1')!.getRememberToken()).toBeNull();

      const me = await handle(context.kernel, 'GET', '/me', {
        headers: {
          accept: 'application/json',
          cookie: `orchestr_session=${sid}; remember_session_recaller=${recaller}`,
        },
      });

      expect(me.status).toBe(401);
    });
  });

  describe('guest middleware', () => {
    it('lets guests through', async () => {
      const res = await handle(context.kernel, 'GET', '/login-form');

      expect(res.status).toBe(200);
      expect(res.body).toBe('login form');
    });

    it('redirects authenticated users home (AC)', async () => {
      const sid = await login();

      const res = await handle(context.kernel, 'GET', '/login-form', {
        headers: { cookie: `orchestr_session=${sid}` },
      });

      expect(res.status).toBe(302);
      expect(res.headers.Location).toBe('/home');
    });

    it('honours a configured dashboard redirect', async () => {
      context.router
        .get('/dash', () => 'x')
        .middleware(makeRedirectIfAuthenticated(context.auth, { redirectTo: '/dashboard' }));
      const sid = await login();

      const res = await handle(context.kernel, 'GET', '/dash', { headers: { cookie: `orchestr_session=${sid}` } });

      expect(res.status).toBe(302);
      expect(res.headers.Location).toBe('/dashboard');
    });
  });

  describe('token guard over HTTP', () => {
    it('authenticates Authorization: Bearer <token> through the middleware (AC)', async () => {
      await MemoryUser.create({ email: 'grace@example.com', api_token: 'tok-grace' });

      const ok = await handle(context.kernel, 'GET', '/api/me', {
        headers: { authorization: 'Bearer tok-grace', accept: 'application/json' },
      });

      expect(ok.status).toBe(200);
      expect(JSON.parse(ok.body)).toEqual({ email: 'grace@example.com' });
    });

    it('401 JSON for a bad bearer token', async () => {
      const res = await handle(context.kernel, 'GET', '/api/me', {
        headers: { authorization: 'Bearer nope', accept: 'application/json' },
      });

      expect(res.status).toBe(401);
      expect(JSON.parse(res.body)).toEqual({ message: 'Unauthenticated.' });
    });
  });

  describe('auth() helper', () => {
    it('resolves guards from the container', () => {
      expect(auth()).toBe(context.auth.guard());
      expect(auth('token')).toBe(context.auth.guard('token'));
      expect(auth('token')).not.toBe(auth());
    });

    it('throws a helpful error when auth is not registered', () => {
      // A fresh application repoints the global app the helpers resolve through
      new Application('/test-empty');

      expect(() => auth()).toThrow(/Authentication is not available/);

      // restore for the remaining tests
      new Application('/test-restore');
    });
  });

  describe('middleware aliases', () => {
    it('the AuthServiceProvider ships auth and guest aliases on boot', () => {
      const aliases = context.router.getMiddleware();

      expect(aliases.auth).toBe(Authenticate);
      expect(aliases.guest).toBe(RedirectIfAuthenticated);
    });

    it('routes reference the alias by name', async () => {
      context.router.get('/private', () => 'secret').middleware('auth');

      const res = await handle(context.kernel, 'GET', '/private', { headers: { accept: 'text/html' } });

      expect(res.status).toBe(302);
      expect(res.headers.Location).toBe('/login');
    });
  });
});
