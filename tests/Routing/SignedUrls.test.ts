/**
 * Signed URLs - UrlGenerator signing, hasValidSignature and the
 * ValidateSignature middleware
 */

import { createApp, createRawRequest, handle } from '@tests/Session/support';
import { describe, it, expect } from 'vitest';
import type { Kernel } from '@/Foundation/Http/Kernel';
import type { Application, Router } from '@/index';
import { MissingAppKeyException } from '@/Encryption/MissingAppKeyException';
import { Config } from '@/Foundation/Config/Config';
import { ValidateSignature, makeValidateSignature } from '@/Routing/Middleware/ValidateSignature';
import { Request } from '@/Routing/Request';
import { Route } from '@/Routing/Route';
import { UrlGenerator } from '@/Routing/UrlGenerator';

/** Raw 32-character key, consumed as-is by the HMAC */
const KEY = '0123456789abcdef0123456789ABCDEF';

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function requestFor(url: string, headers: Record<string, string> = {}): Request {
  return new Request(createRawRequest('GET', url, { headers }));
}

describe('UrlGenerator signed routes', () => {
  function generator(key: string | null = KEY): { gen: UrlGenerator; routes: Map<string, Route> } {
    const routes = new Map<string, Route>();
    const gen = new UrlGenerator(
      () => routes,
      () => key
    );

    function register(name: string, uri: string, configure?: (route: Route) => void): void {
      const route = new Route(['GET', 'HEAD'], uri, () => {});
      route.setName(name);
      if (configure) {
        configure(route);
      }
      routes.set(name, route);
    }

    register('inbox', '/inbox/:user');
    register('unsubscribe', '/newsletters/:id/unsubscribe');
    register('portal', '/portal', (route) => {
      route.domain = 'invoicing.test';
    });

    return { gen, routes };
  }

  it('appends a signature that covers the URL', () => {
    const { gen } = generator();

    const url = gen.signedRoute('inbox', { user: 1 });

    expect(url).toMatch(/^\/inbox\/1\?signature=/);
    expect(gen.hasValidSignature(requestFor(url))).toBe(true);
  });

  it('signs extra query parameters too', () => {
    const { gen } = generator();

    const url = gen.signedRoute('unsubscribe', { id: 9, email: 'b@example.com' });

    expect(url).toContain('email=b%40example.com');
    expect(gen.hasValidSignature(requestFor(url))).toBe(true);
  });

  it('adds and honours an expiry (unix seconds or Date)', () => {
    const { gen } = generator();

    const secondsUrl = gen.signedRoute('inbox', { user: 1 }, nowSeconds() + 60);
    const dateUrl = gen.signedRoute('inbox', { user: 1 }, new Date(Date.now() + 60_000));

    expect(secondsUrl).toMatch(/expires=\d+&signature=/);
    expect(gen.hasValidSignature(requestFor(secondsUrl))).toBe(true);
    expect(gen.hasValidSignature(requestFor(dateUrl))).toBe(true);
  });

  it('temporarySignedRoute builds expiring links (Laravel parameter order)', () => {
    const { gen } = generator();

    const url = gen.temporarySignedRoute('inbox', nowSeconds() + 3600, { user: 1 });

    expect(url).toMatch(/^\/inbox\/1\?expires=\d+&signature=/);
    expect(gen.hasValidSignature(requestFor(url))).toBe(true);

    const stale = gen.temporarySignedRoute('inbox', nowSeconds() - 1, { user: 1 });

    expect(gen.hasValidSignature(requestFor(stale))).toBe(false);
  });

  it('rejects expired links', () => {
    const { gen } = generator();

    const url = gen.signedRoute('inbox', { user: 1 }, nowSeconds() - 30);

    expect(gen.hasValidSignature(requestFor(url))).toBe(false);
  });

  it('accepts links for domain routes when the request carries the host', () => {
    const { gen } = generator();

    const url = gen.signedRoute('portal', { ref: 'nav' });

    expect(url).toMatch(/^http:\/\/invoicing\.test\/portal\?/);

    const relative = url.slice('http://invoicing.test'.length);
    expect(gen.hasValidSignature(requestFor(relative, { host: 'invoicing.test' }))).toBe(true);
  });

  it('rejects modified URLs and forged signatures (AC)', () => {
    const { gen } = generator();

    const url = gen.signedRoute('inbox', { user: 1, folder: 'inbox' });

    // Swap the user ID
    expect(gen.hasValidSignature(requestFor(url.replace('/inbox/1?', '/inbox/2?')))).toBe(false);

    // Change the value of a signed query parameter
    expect(gen.hasValidSignature(requestFor(url.replace('folder=inbox', 'folder=sent')))).toBe(false);

    // Append a parameter
    expect(gen.hasValidSignature(requestFor(`${url}&admin=1`))).toBe(false);

    // A signature lifted from another URL
    const other = gen.signedRoute('inbox', { user: 2 });
    const forged = url.replace(/signature=[^&]+/, `signature=${other.split('signature=')[1]}`);
    expect(forged).not.toBe(url);
    expect(gen.hasValidSignature(requestFor(forged))).toBe(false);
  });

  it('rejects requests without a signature or with a broken expiry', () => {
    const { gen } = generator();

    expect(gen.hasValidSignature(requestFor('/inbox/1'))).toBe(false);
    expect(gen.hasValidSignature(requestFor('/inbox/1?signature='))).toBe(false);
    expect(gen.hasValidSignature(requestFor('/inbox/1?expires=abc&signature=whatever'))).toBe(false);
  });

  it('fails fast when the application key is missing', () => {
    const { gen } = generator(null);

    expect(() => gen.signedRoute('inbox', { user: 1 })).toThrow(MissingAppKeyException);
    expect(() => gen.hasValidSignature(requestFor('/inbox/1?signature=abc'))).toThrow(MissingAppKeyException);
  });

  it('accepts base64-prefixed keys', () => {
    const { gen } = generator('base64:' + Buffer.from(KEY).toString('base64'));

    const url = gen.signedRoute('inbox', { user: 1 });

    expect(gen.hasValidSignature(requestFor(url))).toBe(true);
  });
});

describe('Signed URLs through the Router', () => {
  it('forwards signedRoute/temporarySignedRoute/hasValidSignature', () => {
    const { app, router } = createApp();
    app.instance('config', new Config({ app: { key: KEY } }));

    const route = router.get('/invite/:user', () => 'ok');
    router.name('invite', route);

    const url = router.temporarySignedRoute('invite', nowSeconds() + 60, { user: 7 });

    expect(url).toMatch(/^\/invite\/7\?expires=\d+&signature=/);
    expect(router.hasValidSignature(requestFor(url))).toBe(true);
  });

  it('reads APP_KEY from the environment when no config is bound', () => {
    const { router } = createApp();
    process.env.APP_KEY = KEY;

    try {
      const route = router.get('/invite', () => 'ok');
      router.name('invite', route);

      const url = router.signedRoute('invite');

      expect(router.hasValidSignature(requestFor(url))).toBe(true);
    } finally {
      delete process.env.APP_KEY;
    }
  });
});

describe('ValidateSignature middleware', () => {
  function build(): { app: Application; router: Router; kernel: Kernel } {
    const harness = createApp();
    harness.app.instance('config', new Config({ app: { key: KEY } }));
    harness.kernel.use(ValidateSignature);

    const report = harness.router.get('/report', () => 'secret numbers');
    harness.router.name('report', report);

    return harness;
  }

  it('answers 200 for a valid signature', async () => {
    const harness = build();

    const url = harness.router.signedRoute('report');
    const res = await handle(harness.kernel, 'GET', url);

    expect(res.status).toBe(200);
    expect(res.body).toContain('secret numbers');
  });

  it('rejects expired links with 403', async () => {
    const harness = build();

    const stale = harness.router.signedRoute('report', {}, nowSeconds() - 5);
    const res = await handle(harness.kernel, 'GET', stale);

    expect(res.status).toBe(403);
    expect(res.body).toContain('Invalid signature');
  });

  it('rejects tampered links and unsigned requests with 403', async () => {
    const harness = build();

    const url = harness.router.signedRoute('report', { refund: 500 });

    const modified = await handle(harness.kernel, 'GET', url.replace('refund=500', 'refund=5000'));
    expect(modified.status).toBe(403);

    const swapped = await handle(harness.kernel, 'GET', url.replace('/report', '/reports'));
    expect(swapped.status).toBe(403);

    const bare = await handle(harness.kernel, 'GET', '/report');
    expect(bare.status).toBe(403);
    expect(bare.body).toContain('Invalid signature');
  });

  it('honours the temporarySignedRoute lifetime end to end', async () => {
    const harness = build();

    const fresh = harness.router.temporarySignedRoute('report', nowSeconds() + 60);
    expect((await handle(harness.kernel, 'GET', fresh)).status).toBe(200);

    const old = harness.router.temporarySignedRoute('report', nowSeconds() - 1);
    expect((await handle(harness.kernel, 'GET', old)).status).toBe(403);
  });

  it('runs as a named alias over a single route through the router seam', async () => {
    const harness = createApp();
    harness.app.instance('config', new Config({ app: { key: KEY } }));
    harness.kernel.middlewareAlias(
      'signed',
      makeValidateSignature(() => harness.router)
    );

    const preview = harness.router.get('/preview/:file', () => 'preview').middleware('signed');
    harness.router.name('preview', preview);
    harness.router.get('/open/:file', () => 'open');

    const signed = harness.router.signedRoute('preview', { file: 'deck.pdf' });
    expect((await handle(harness.kernel, 'GET', signed)).status).toBe(200);

    const wrongSignature = signed.replace(/signature=[^&]+/, 'signature=nope');
    expect((await handle(harness.kernel, 'GET', wrongSignature)).status).toBe(403);

    // The unsigned sibling route keeps working
    expect((await handle(harness.kernel, 'GET', '/open/deck.pdf')).status).toBe(200);
  });

  it('keeps unprotected routes unaffected when the middleware is not registered', async () => {
    const harness = createApp();
    harness.router.get('/report', () => 'public numbers');

    const res = await handle(harness.kernel, 'GET', '/report');

    expect(res.status).toBe(200);
  });
});
