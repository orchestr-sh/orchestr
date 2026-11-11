import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from '@/Facades/Session';
import { Config } from '@/Foundation/Config/Config';
import { makeStartSession, StartSession } from '@/Session/Middleware/StartSession';
import { SessionManager } from '@/Session/SessionManager';
import { SessionServiceProvider } from '@/Session/SessionServiceProvider';
import { ArraySessionStore } from '@/Session/Stores/ArraySessionStore';
import { Facade } from '@/Support/Facade';
import { csrf_field, csrf_token, session } from '@/Support/helpers';
import { createApp, cookieHeader, cookieValue, handle } from './support';

describe('StartSession middleware', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'orchestr-sessions-'));
    ArraySessionStore.clear();
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  describe('with the file store', () => {
    it('Session.put() from one request is readable in the next', async () => {
      const { app, router, kernel } = createApp();
      const manager = new SessionManager({ driver: 'file', files: directory });
      kernel.use(makeStartSession(manager));

      router.get('/write', (req: any) => {
        req.session().put('greeting', 'hello');

        return 'written';
      });
      router.get('/read', (req: any) => ({ greeting: req.session().get('greeting') ?? null }));

      const first = await handle(kernel, 'GET', '/write');
      expect(first.status).toBe(200);

      const sid = cookieValue(first.cookies, 'orchestr_session');
      expect(sid).toMatch(/^[a-zA-Z0-9]{40}$/);

      const second = await handle(kernel, 'GET', '/read', { headers: { cookie: `orchestr_session=${sid}` } });

      expect(JSON.parse(second.body)).toEqual({ greeting: 'hello' });
    });

    it('flash data is available for exactly one subsequent request', async () => {
      const { router, kernel } = createApp();
      const manager = new SessionManager({ driver: 'file', files: directory });
      kernel.use(makeStartSession(manager));

      router.get('/flash', (req: any) => {
        req.session().flash('status', 'Created');

        return 'ok';
      });
      router.get('/peek', (req: any) => ({ status: req.session().get('status') ?? null }));

      const boot = await handle(kernel, 'GET', '/flash');
      const sid = cookieValue(boot.cookies, 'orchestr_session')!;
      const cookie = { cookie: `orchestr_session=${sid}` };

      const next = await handle(kernel, 'GET', '/peek', { headers: cookie });
      expect(JSON.parse(next.body)).toEqual({ status: 'Created' });

      const later = await handle(kernel, 'GET', '/peek', { headers: cookie });
      expect(JSON.parse(later.body)).toEqual({ status: null });
    });

    it('regenerate() changes the cookie ID while keeping the data', async () => {
      const { router, kernel } = createApp();
      const manager = new SessionManager({ driver: 'file', files: directory });
      kernel.use(makeStartSession(manager));

      router.get('/guest', (req: any) => {
        req.session().put('cart', '3 items');

        return 'ok';
      });
      router.post('/login', (req: any) => {
        req.session().regenerate();
        req.session().put('user', 'ada');

        return 'ok';
      });
      router.get('/me', (req: any) => ({
        cart: req.session().get('cart') ?? null,
        user: req.session().get('user') ?? null,
      }));

      const guest = await handle(kernel, 'GET', '/guest');
      const guestSid = cookieValue(guest.cookies, 'orchestr_session')!;

      const login = await handle(kernel, 'POST', '/login', { headers: { cookie: `orchestr_session=${guestSid}` } });
      const newSid = cookieValue(login.cookies, 'orchestr_session')!;

      expect(newSid).not.toBe(guestSid);

      const me = await handle(kernel, 'GET', '/me', { headers: { cookie: `orchestr_session=${newSid}` } });
      expect(JSON.parse(me.body)).toEqual({ cart: '3 items', user: 'ada' });

      // The pre-login session ID no longer resolves to the authenticated data
      const stale = await handle(kernel, 'GET', '/me', { headers: { cookie: `orchestr_session=${guestSid}` } });
      expect(JSON.parse(stale.body)).toEqual({ cart: null, user: null });
    });

    it('applies the documented cookie security defaults', async () => {
      const { router, kernel } = createApp();
      const manager = new SessionManager({ driver: 'file', files: directory });
      kernel.use(makeStartSession(manager));
      router.get('/x', (req: any) => {
        req.session().put('k', 'v');

        return 'ok';
      });

      const res = await handle(kernel, 'GET', '/x');
      const header = cookieHeader(res.cookies, 'orchestr_session')!;

      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Lax');
      expect(header).toContain('Path=/');
      expect(header).toContain('Max-Age=7200');
      expect(header).not.toContain('Secure');

      const secureManager = new SessionManager({ driver: 'file', files: directory, secure: true });
      const secureKernel = secureKernelWith(secureManager);
      const secure = await handle(secureKernel, 'GET', '/x');

      expect(cookieHeader(secure.cookies, 'orchestr_session')).toContain('Secure');
    });

    it('configures name, lifetime, path and domain through the provider', async () => {
      const { app, router, kernel } = createApp();
      app.instance(
        'config',
        new Config({
          app: { key: 'test-key' },
          session: {
            driver: 'file',
            files: directory,
            cookie: 'my_app_session',
            lifetime: 10,
            path: '/admin',
            domain: 'example.com',
          },
        })
      );
      app.register(SessionServiceProvider);
      kernel.use(StartSession);

      router.get('/x', () => 'ok');

      const res = await handle(kernel, 'GET', '/x');
      const header = cookieHeader(res.cookies, 'my_app_session')!;

      expect(header).toContain('Max-Age=600');
      expect(header).toContain('Path=/admin');
      expect(header).toContain('Domain=example.com');
    });

    it('defaults to a Secure cookie only in production', async () => {
      const previous = process.env.NODE_ENV;

      try {
        process.env.NODE_ENV = 'production';

        const { app, router, kernel } = createApp();
        app.instance('config', new Config({ session: { driver: 'file', files: directory } }));
        app.register(SessionServiceProvider);
        kernel.use(StartSession);
        router.get('/x', () => 'ok');

        const res = await handle(kernel, 'GET', '/x');
        expect(cookieHeader(res.cookies, 'orchestr_session')).toContain('Secure');
      } finally {
        process.env.NODE_ENV = previous;
      }
    });
  });

  describe('with the cookie store', () => {
    it('carries the whole signed session through the cookie', async () => {
      const { router, kernel } = createApp();
      const manager = new SessionManager({ driver: 'cookie', key: 'app-key' });
      kernel.use(makeStartSession(manager));

      router.get('/write', (req: any) => {
        req.session().put('greeting', 'hello');

        return 'ok';
      });
      router.get('/read', (req: any) => ({ greeting: req.session().get('greeting') ?? null }));

      const first = await handle(kernel, 'GET', '/write');
      const payload = cookieValue(first.cookies, 'orchestr_session')!;
      expect(payload).toContain('.');

      const second = await handle(kernel, 'GET', '/read', { headers: { cookie: `orchestr_session=${payload}` } });
      expect(JSON.parse(second.body)).toEqual({ greeting: 'hello' });
    });

    it('starts over when the cookie payload is tampered with', async () => {
      const { router, kernel } = createApp();
      const manager = new SessionManager({ driver: 'cookie', key: 'app-key' });
      kernel.use(makeStartSession(manager));

      router.get('/read', (req: any) => ({ greeting: req.session().get('greeting') ?? null }));

      const forged = `${'A'.repeat(50)}.not-a-real-signature`;
      const res = await handle(kernel, 'GET', '/read', { headers: { cookie: `orchestr_session=${forged}` } });

      expect(JSON.parse(res.body)).toEqual({ greeting: null });
      expect(cookieValue(res.cookies, 'orchestr_session')).not.toBe(forged);
    });

    it('ages flash data inside the cookie across requests', async () => {
      const { router, kernel } = createApp();
      const manager = new SessionManager({ driver: 'cookie', key: 'app-key' });
      kernel.use(makeStartSession(manager));

      router.get('/flash', (req: any) => {
        req.session().flash('status', 'Created');

        return 'ok';
      });
      router.get('/peek', (req: any) => ({ status: req.session().get('status') ?? null }));

      const boot = await handle(kernel, 'GET', '/flash');
      let payload = cookieValue(boot.cookies, 'orchestr_session')!;

      const next = await handle(kernel, 'GET', '/peek', { headers: { cookie: `orchestr_session=${payload}` } });
      expect(JSON.parse(next.body)).toEqual({ status: 'Created' });

      payload = cookieValue(next.cookies, 'orchestr_session')!;
      const later = await handle(kernel, 'GET', '/peek', { headers: { cookie: `orchestr_session=${payload}` } });
      expect(JSON.parse(later.body)).toEqual({ status: null });
    });
  });

  describe('session access surfaces', () => {
    it('Request.session() throws a helpful error when middleware did not run', async () => {
      const { router, kernel } = createApp();
      router.get('/bare', (req: any) => req.session());

      const res = await handle(kernel, 'GET', '/bare');

      expect(res.status).toBe(500);
      expect(res.body).toContain('Session store not set on request');
    });

    it('exposes the session through the Session facade, session() and config helpers', async () => {
      const { app, router, kernel } = createApp();
      const manager = new SessionManager({ driver: 'file', files: directory });
      app.instance('session', manager);
      Facade.setFacadeApplication(app);
      kernel.use(makeStartSession(manager));

      router.get('/surfaces', () => {
        Session.put('facade', 'yes');
        session({ helper: 'yes' });

        return {
          viaFacade: Session.get('facade'),
          viaHelper: session('helper'),
          viaRequest: session()!.get('facade'),
          currentId: Session.getId(),
        };
      });
      router.get('/second', () => ({ facade: Session.get('facade') ?? null }));

      const res = await handle(kernel, 'GET', '/surfaces');

      expect(JSON.parse(res.body)).toEqual({
        viaFacade: 'yes',
        viaHelper: 'yes',
        viaRequest: 'yes',
        currentId: manager.current()!.getId(),
      });

      // Session.put() from the first request survives into the second (file store)
      const sid = cookieValue(res.cookies, 'orchestr_session')!;
      const second = await handle(kernel, 'GET', '/second', { headers: { cookie: `orchestr_session=${sid}` } });

      expect(JSON.parse(second.body)).toEqual({ facade: 'yes' });
    });

    it('csrf_token() and csrf_field() read the active session', async () => {
      const { app, router, kernel } = createApp();
      const manager = new SessionManager({ driver: 'array' });
      app.instance('session', manager);
      kernel.use(makeStartSession(manager));

      router.get('/form', () => ({
        token: csrf_token(),
        field: csrf_field(),
      }));

      const res = await handle(kernel, 'GET', '/form');
      const body = JSON.parse(res.body);

      expect(body.token).toMatch(/^[a-zA-Z0-9]{40}$/);
      expect(body.field).toBe(`<input type="hidden" name="_token" value="${body.token}" autocomplete="off">`);

      // The token belongs to this request's active session
      expect(manager.current()!.token()).toBe(body.token);
    });

    it('csrf helpers report a clear error when no session is active', () => {
      // A fresh application without the session binding - createApp()
      // repoints the global app the helpers resolve through
      createApp();

      expect(session()).toBeNull();
      expect(() => csrf_token()).toThrow(/No active session/);
      expect(() => session('anything')).toThrow(/No active session/);
      expect(() => csrf_field()).toThrow(/No active session/);
    });
  });
});

function secureKernelWith(manager: SessionManager) {
  const { router, kernel } = createApp();
  kernel.use(makeStartSession(manager));
  router.get('/x', () => 'ok');

  return kernel;
}
