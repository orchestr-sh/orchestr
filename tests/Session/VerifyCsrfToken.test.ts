import { beforeEach, describe, expect, it } from 'vitest';
import type { Kernel } from '@/Foundation/Http/Kernel';
import type { Router } from '@/Routing/Router';
import { Config } from '@/Foundation/Config/Config';
import { makeStartSession, StartSession } from '@/Session/Middleware/StartSession';
import { makeVerifyCsrfToken, VerifyCsrfToken, XSRF_COOKIE_NAME } from '@/Session/Middleware/VerifyCsrfToken';
import { SessionManager } from '@/Session/SessionManager';
import { ArraySessionStore } from '@/Session/Stores/ArraySessionStore';
import { TokenMismatchException } from '@/Session/TokenMismatchException';
import { createApp, cookieHeader, cookieValue, handle } from './support';

describe('VerifyCsrfToken middleware', () => {
  interface Harness {
    router: Router;
    kernel: Kernel;
    manager: SessionManager;
  }

  function build(appConfig: Record<string, any> = {}, csrfOptions: { except?: string[] } = {}): Harness {
    const { app, router, kernel } = createApp();
    const manager = new SessionManager({ driver: 'array' });
    app.instance('session', manager);

    if (Object.keys(appConfig).length > 0) {
      app.instance('config', new Config(appConfig));
    }

    kernel.use([
      makeStartSession(manager),
      makeVerifyCsrfToken({ manager: () => manager, except: csrfOptions.except }),
    ]);
    router.get('/balance', () => 'ok');
    router.post('/charge', () => 'charged');
    router.put('/profile', () => 'updated');
    router.delete('/account', () => 'deleted');

    return { router, kernel, manager };
  }

  /**
   * Boot a session over GET and hand back its session cookie plus the
   * CSRF token, the way a browser form would have received both
   */
  async function boot(harness: Harness): Promise<{ headers: Record<string, string>; token: string }> {
    const res = await handle(harness.kernel, 'GET', '/balance');
    const sid = cookieValue(res.cookies, 'orchestr_session')!;
    const token = cookieValue(res.cookies, XSRF_COOKIE_NAME)!;

    return { headers: { cookie: `orchestr_session=${sid}` }, token };
  }

  beforeEach(() => {
    ArraySessionStore.clear();
  });

  it('rejects a POST without any token with 419', async () => {
    const harness = build();
    const { headers } = await boot(harness);

    const res = await handle(harness.kernel, 'POST', '/charge', { headers });

    expect(res.status).toBe(419);
    expect(res.body).toContain('CSRF token mismatch');
  });

  it('rejects a POST carrying the wrong token', async () => {
    const harness = build();
    await boot(harness);

    const res = await handle(harness.kernel, 'POST', '/charge', {
      headers: { 'x-csrf-token': 'z'.repeat(40) },
    });

    expect(res.status).toBe(419);
  });

  it('rejects a request that presents a token for a session it does not have', async () => {
    const harness = build();

    const res = await handle(harness.kernel, 'POST', '/charge', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '_token=nope-nope-nope',
    });

    expect(res.status).toBe(419);
  });

  it('accepts the _token form input', async () => {
    const harness = build();
    const { headers, token } = await boot(harness);

    const res = await handle(harness.kernel, 'POST', '/charge', {
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      body: `_token=${token}&amount=10`,
    });

    expect(res.status).toBe(200);
    expect(res.body).toBe('charged');
  });

  it('accepts the _token query parameter', async () => {
    const harness = build();
    const { headers, token } = await boot(harness);

    const res = await handle(harness.kernel, 'POST', `/charge?_token=${token}`, { headers });

    expect(res.status).toBe(200);
  });

  it('accepts the X-CSRF-TOKEN header', async () => {
    const harness = build();
    const { headers, token } = await boot(harness);

    const res = await handle(harness.kernel, 'POST', '/charge', { headers: { ...headers, 'X-CSRF-TOKEN': token } });

    expect(res.status).toBe(200);
  });

  it('accepts the X-XSRF-TOKEN header', async () => {
    const harness = build();
    const { headers, token } = await boot(harness);

    const res = await handle(harness.kernel, 'POST', '/charge', { headers: { ...headers, 'X-XSRF-TOKEN': token } });

    expect(res.status).toBe(200);
  });

  it('accepts a JSON body carrying _token', async () => {
    const harness = build();
    const { headers, token } = await boot(harness);

    const res = await handle(harness.kernel, 'POST', '/charge', {
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ _token: token }),
    });

    expect(res.status).toBe(200);
  });

  it('guards PUT and DELETE as well as POST', async () => {
    const harness = build();
    const { headers, token } = await boot(harness);

    const form = { 'content-type': 'application/x-www-form-urlencoded' };

    expect(
      (await handle(harness.kernel, 'PUT', '/profile', { headers: { ...headers, ...form }, body: `_token=${token}` }))
        .status
    ).toBe(200);
    expect((await handle(harness.kernel, 'DELETE', '/account', { headers })).status).toBe(419);
  });

  it('lets safe methods through without any token', async () => {
    const harness = build();

    expect((await handle(harness.kernel, 'GET', '/balance')).status).toBe(200);
    expect((await handle(harness.kernel, 'HEAD', '/balance')).status).not.toBe(419);
    expect((await handle(harness.kernel, 'OPTIONS', '/balance')).status).not.toBe(419);
  });

  it('hands the client a readable XSRF-TOKEN cookie alongside the session cookie', async () => {
    const harness = build();

    const res = await handle(harness.kernel, 'GET', '/balance');
    const xsrf = cookieHeader(res.cookies, XSRF_COOKIE_NAME)!;
    const sid = cookieValue(res.cookies, 'orchestr_session')!;

    expect(xsrf).toContain(harness.manager.current()!.token());
    expect(xsrf).not.toContain('HttpOnly');

    // Re-present the XSRF cookie value as the header an SPA would send
    const token = cookieValue(res.cookies, XSRF_COOKIE_NAME)!;
    const post = await handle(harness.kernel, 'POST', '/charge', {
      headers: { cookie: `orchestr_session=${sid}`, 'X-XSRF-TOKEN': token },
    });

    expect(post.status).toBe(200);
  });

  it('excludes URIs passed to the middleware factory', async () => {
    const harness = build({}, { except: ['webhooks/stripe'] });
    harness.router.post('/webhooks/stripe', () => 'received');

    const res = await handle(harness.kernel, 'POST', '/webhooks/stripe');

    expect(res.status).toBe(200);
    expect(res.body).toBe('received');

    // Everything else still needs a token
    expect((await handle(harness.kernel, 'POST', '/charge')).status).toBe(419);
  });

  it('honours wildcard patterns in the csrf.except config', async () => {
    const harness = build({ csrf: { except: ['/api/*', 'public/*'] } });
    harness.router.post('/api/ingest', () => 'ingested');
    harness.router.post('/public/ping', () => 'pong');

    expect((await handle(harness.kernel, 'POST', '/api/ingest')).status).toBe(200);
    expect((await handle(harness.kernel, 'POST', '/public/ping')).status).toBe(200);
    expect((await handle(harness.kernel, 'POST', '/charge')).status).toBe(419);
  });

  it('still saves the session and rotates nothing on rejected requests', async () => {
    const harness = build();
    harness.router.post('/flashy', (req: any) => {
      req.session().flash('status', 'Created');

      return 'ok';
    });

    const { headers, token } = await boot(harness);
    const form = { 'content-type': 'application/x-www-form-urlencoded' };

    const flashed = await handle(harness.kernel, 'POST', '/flashy', {
      headers: { ...headers, ...form },
      body: `_token=${token}`,
    });
    expect(flashed.status).toBe(200);

    const rejected = await handle(harness.kernel, 'POST', '/flashy', {
      headers: { ...headers, ...form },
      body: '_token=whatever',
    });

    expect(rejected.status).toBe(419);
    // The session middleware keeps its cookie seam even on error responses
    expect(cookieValue(rejected.cookies, 'orchestr_session')).toBe(sidFrom(headers));
  });

  it('rotates the CSRF token on regenerate(), the way login flows will use it', async () => {
    const harness = build();
    harness.router.post('/login', (req: any) => {
      req.session().regenerate();

      return { token: req.session().token() };
    });

    const { headers, token: oldToken } = await boot(harness);

    const login = await handle(harness.kernel, 'POST', '/login', {
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      body: `_token=${oldToken}`,
    });
    expect(login.status).toBe(200);

    const newToken = cookieValue(login.cookies, XSRF_COOKIE_NAME)!;
    const newSid = cookieValue(login.cookies, 'orchestr_session')!;
    expect(newSid).not.toBe(sidFrom(headers));
    expect(newToken).not.toBe(oldToken);
    expect(JSON.parse(login.body).token).toBe(newToken);

    // The pre-login token is dead; the rotated one works with the new ID
    const stale = await handle(harness.kernel, 'POST', '/charge', {
      headers: { cookie: `orchestr_session=${newSid}`, 'X-CSRF-TOKEN': oldToken },
    });
    expect(stale.status).toBe(419);

    const fresh = await handle(harness.kernel, 'POST', '/charge', {
      headers: { cookie: `orchestr_session=${newSid}`, 'X-CSRF-TOKEN': newToken },
    });
    expect(fresh.status).toBe(200);
  });

  it('TokenMismatchException carries the 419 status', () => {
    const exception = new TokenMismatchException();

    expect(exception).toBeInstanceOf(Error);
    expect(exception.getStatus()).toBe(419);
    expect(exception.message).toBe('CSRF token mismatch.');
  });

  it('the default exports resolve their services from the container', async () => {
    const { app, router, kernel } = createApp();
    const manager = new SessionManager({ driver: 'array' });
    app.instance('session', manager);

    kernel.use([StartSession, VerifyCsrfToken]);
    router.get('/balance', () => 'ok');
    router.post('/charge', () => 'charged');

    const bootRes = await handle(kernel, 'GET', '/balance');
    expect(bootRes.status).toBe(200);
    const sid = cookieValue(bootRes.cookies, 'orchestr_session')!;
    const token = cookieValue(bootRes.cookies, XSRF_COOKIE_NAME)!;

    expect((await handle(kernel, 'POST', '/charge', { headers: { cookie: `orchestr_session=${sid}` } })).status).toBe(
      419
    );

    const accepted = await handle(kernel, 'POST', `/charge?_token=${token}`, {
      headers: { cookie: `orchestr_session=${sid}` },
    });
    expect(accepted.status).toBe(200);
  });

  function sidFrom(headers: Record<string, string>): string {
    return headers.cookie.slice('orchestr_session='.length);
  }
});
