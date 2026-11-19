/**
 * ThrottleRequests middleware - HTTP-level rate limiting
 *
 * Drives the full Kernel stack over the container-bound 'limiter' (the
 * RateLimiterServiceProvider ships the 'throttle' alias on boot) to check
 * window enforcement, the X-RateLimit headers, 429 rendering (JSON and
 * HTML), named limiters, keying by user ID or IP, and decay reset.
 */

import { captureResponse, createRawRequest } from '@tests/Session/support';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { Middleware } from '@/Routing/Pipeline';
import { CacheServiceProvider } from '@/Cache/CacheServiceProvider';
import { RateLimiter } from '@/Cache/RateLimiter';
import { RateLimiterServiceProvider } from '@/Cache/RateLimiterServiceProvider';
import { Limit } from '@/Cache/RateLimiting/Limit';
import { Unlimited } from '@/Cache/RateLimiting/Unlimited';
import { RateLimiter as RateLimiterFacade } from '@/Facades/RateLimiter';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { Kernel } from '@/Foundation/Http/Kernel';
import { Request } from '@/Routing/Request';
import { Response } from '@/Routing/Response';
import { JsonResponse } from '@/Routing/Responses';
import { Router } from '@/Routing/Router';
import { Facade } from '@/Support/Facade';

interface Captured {
  status: number;
  body: string;
  headers: Record<string, string>;
}

interface Harness {
  app: Application;
  router: Router;
  kernel: Kernel;
  limiter: RateLimiter;
  request(method: string, url: string, headers?: Record<string, string>, remoteAddress?: string): Promise<Captured>;
}

/**
 * Application with caching, the limiter and a booted Kernel - the same
 * wiring an app gets from registering RateLimiterServiceProvider
 */
async function createHarness(configure?: (ctx: Harness) => void): Promise<Harness> {
  const app = new Application('/test');

  app.instance('config', new Config({ cache: { default: 'array', stores: { array: { driver: 'array' } } } }));
  app.register(CacheServiceProvider);

  const router = new Router(app);
  app.singleton('router', () => router);

  app.register(RateLimiterServiceProvider);

  const kernel = new Kernel(app);
  app.instance('kernel', kernel);

  await app.boot();

  const harness: Harness = {
    app,
    router,
    kernel,
    limiter: app.make<RateLimiter>('limiter'),
    async request(method, url, headers = {}, remoteAddress) {
      const { raw, chunks, headers: sentHeaders } = captureResponse();

      await kernel.handle(createRawRequest(method, url, { headers, remoteAddress }), raw);

      return { status: raw.statusCode, body: chunks.join(''), headers: sentHeaders };
    },
  };

  // Keep the RateLimiter facade pointed at this harness's limiter
  Facade.setFacadeApplication(app);
  Facade.clearResolvedInstances();

  configure?.(harness);

  return harness;
}

function fakeUser(identifier: string | number): Authenticatable {
  return {
    getAuthIdentifierName: () => 'id',
    getAuthIdentifier: () => identifier,
    getAuthPasswordName: () => 'password',
    getAuthPassword: () => null,
    getRememberToken: () => null,
    setRememberToken: () => undefined,
    getRememberTokenName: () => '',
  } as unknown as Authenticatable;
}

/** Route middleware binding whichever user the test parked in `current` */
function bindUser(current: () => Authenticatable | null): Middleware {
  return async (req: Request, _res: Response, next) => {
    req.setUserResolver(async () => current());

    return next();
  };
}

function respondOk(_req: Request, res: Response): void {
  res.send('ok');
}

describe('ThrottleRequests middleware', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('numeric throttle:max,decay references', () => {
    it('allows max attempts and rejects the next one with a 429', async () => {
      const { request } = await createHarness(({ router }) => {
        router.get('/x', respondOk).middleware('throttle:2,1');
      });

      expect((await request('GET', '/x')).status).toBe(200);
      expect((await request('GET', '/x')).status).toBe(200);

      const limited = await request('GET', '/x', { accept: 'application/json' });

      expect(limited.status).toBe(429);
      expect(JSON.parse(limited.body).message).toBe('Too Many Attempts.');
    });

    it('throttle:60,1 admits 60 requests per minute and rejects the 61st', async () => {
      const { request } = await createHarness(({ router }) => {
        router.get('/x', respondOk).middleware('throttle:60,1');
      });

      for (let attempt = 1; attempt <= 60; attempt++) {
        const response = await request('GET', '/x');

        expect(response.status, `request ${attempt}`).toBe(200);
      }

      expect((await request('GET', '/x')).status).toBe(429);
    });

    it('carries the rate limit headers on admitted responses', async () => {
      const { request } = await createHarness(({ router }) => {
        router.get('/x', respondOk).middleware('throttle:5,1');
      });

      const first = await request('GET', '/x');

      expect(first.status).toBe(200);
      expect(first.headers['X-RateLimit-Limit']).toBe('5');
      expect(first.headers['X-RateLimit-Remaining']).toBe('4');
      expect(first.headers['Retry-After']).toBe('60');

      const second = await request('GET', '/x');

      expect(second.headers['X-RateLimit-Remaining']).toBe('3');
    });

    it('carries Retry-After and the limit headers on the rejected response', async () => {
      const { request } = await createHarness(({ router }) => {
        router.get('/x', respondOk).middleware('throttle:1,1');
      });

      await request('GET', '/x');

      const limited = await request('GET', '/x', { accept: 'application/json' });

      expect(limited.status).toBe(429);
      expect(limited.headers['X-RateLimit-Limit']).toBe('1');
      expect(limited.headers['X-RateLimit-Remaining']).toBe('0');
      expect(limited.headers['Retry-After']).toBe('60');
      expect(limited.headers['X-RateLimit-Reset']).toBeDefined();
    });

    it('resets the window after the decay minutes have passed', async () => {
      const { request } = await createHarness(({ router }) => {
        router.get('/x', respondOk).middleware('throttle:1,1');
      });

      await request('GET', '/x');

      expect((await request('GET', '/x')).status).toBe(429);

      vi.advanceTimersByTime(61_000);

      expect((await request('GET', '/x')).status).toBe(200);
    });

    it('defaults to 60 attempts per minute for a bare throttle reference', async () => {
      const { request } = await createHarness(({ router }) => {
        router.get('/x', respondOk).middleware('throttle');
      });

      const admitted = await request('GET', '/x');

      expect(admitted.status).toBe(200);
      expect(admitted.headers['X-RateLimit-Limit']).toBe('60');
      expect(admitted.headers['X-RateLimit-Remaining']).toBe('59');
      expect(admitted.headers['Retry-After']).toBe('60');
    });

    it('negotiates the 429 body between JSON and HTML', async () => {
      const { request } = await createHarness(({ router }) => {
        router.get('/x', respondOk).middleware('throttle:1,1');
      });

      await request('GET', '/x');

      const html = await request('GET', '/x', { accept: 'text/html' });

      expect(html.status).toBe(429);
      expect(html.body).toContain('Too Many Attempts.');
      expect(html.headers['Content-Type']).toContain('text/html');

      await request('GET', '/x');

      const json = await request('GET', '/x', { accept: 'application/json' });

      expect(json.status).toBe(429);
      expect(json.headers['Content-Type']).toContain('application/json');
    });

    it('runs from the Kernel global stack for every route', async () => {
      const { request } = await createHarness(({ kernel, router }) => {
        kernel.use('throttle:2,1');
        router.get('/a', respondOk);
        router.get('/b', respondOk);
      });

      // The global stack has no matched route yet, so guests are keyed by
      // method and path: each path gets its own 2-per-minute window
      expect((await request('GET', '/a')).status).toBe(200);
      expect((await request('GET', '/b')).status).toBe(200);
      expect((await request('GET', '/a')).status).toBe(200);
      expect((await request('GET', '/a')).status).toBe(429);
      expect((await request('GET', '/b')).status).toBe(200);
    });

    it('rejects unknown limiter names', async () => {
      const { request } = await createHarness(({ router }) => {
        router.get('/x', respondOk).middleware('throttle:ghost');
      });

      const response = await request('GET', '/x');

      expect(response.status).toBe(500);
      expect(response.body).toContain('ghost');
    });
  });

  describe('named limiters', () => {
    it('throttle:name runs the registered limiter definition', async () => {
      const { request } = await createHarness(({ limiter, router }) => {
        limiter.define('chat', () => Limit.perSeconds(2, 30));

        router.get('/chat', respondOk).middleware('throttle:chat');
      });

      expect((await request('GET', '/chat')).status).toBe(200);
      expect((await request('GET', '/chat')).status).toBe(200);

      const limited = await request('GET', '/chat', { accept: 'application/json' });

      expect(limited.status).toBe(429);
      expect(limited.headers['X-RateLimit-Limit']).toBe('2');
      expect(limited.headers['Retry-After']).toBe('30');
    });

    it('supports several limits on one named limiter, advertising the tightest', async () => {
      const { request } = await createHarness(({ limiter, router }) => {
        limiter.define('multi', () => [Limit.perMinute(10).by('multi:minute'), Limit.perSecond(1).by('multi:second')]);

        router.get('/x', respondOk).middleware('throttle:multi');
      });

      const first = await request('GET', '/x');

      expect(first.status).toBe(200);
      // The one-per-second window is the one closest to breaching
      expect(first.headers['X-RateLimit-Limit']).toBe('1');

      expect((await request('GET', '/x')).status).toBe(429);
    });

    it('honours a custom 429 message from the limit definition', async () => {
      const { request } = await createHarness(({ limiter, router }) => {
        limiter.define('chat', () => Limit.perSeconds(1, 30).messages('Chat is cooling down.'));

        router.get('/x', respondOk).middleware('throttle:chat');
      });

      await request('GET', '/x');

      const limited = await request('GET', '/x', { accept: 'application/json' });

      expect(limited.status).toBe(429);
      expect(JSON.parse(limited.body).message).toBe('Chat is cooling down.');
    });

    it('lets a custom response replace the 429, keeping the headers', async () => {
      const { request } = await createHarness(({ limiter, router }) => {
        limiter.define('chat', () =>
          Limit.perSeconds(1, 30).response(
            (_req, headers) => new JsonResponse({ error: 'slow_down', retry: headers['Retry-After'] }, 429)
          )
        );

        router.get('/x', respondOk).middleware('throttle:chat');
      });

      await request('GET', '/x');

      const limited = await request('GET', '/x');

      expect(limited.status).toBe(429);
      expect(JSON.parse(limited.body)).toEqual({ error: 'slow_down', retry: '30' });
      expect(limited.headers['X-RateLimit-Limit']).toBe('1');
      expect(limited.headers['X-RateLimit-Remaining']).toBe('0');
    });

    it('Unlimited exempts the request without counting or header decoration', async () => {
      const { request } = await createHarness(({ limiter, router }) => {
        limiter.define('open', () => new Unlimited());

        router.get('/x', respondOk).middleware('throttle:open');
      });

      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await request('GET', '/x');

        expect(response.status).toBe(200);
        expect(response.headers['X-RateLimit-Limit']).toBeUndefined();
      }
    });

    it('falls back to the request signature when the limit does not name a key', async () => {
      const { request } = await createHarness(({ limiter, router }) => {
        limiter.define('sig', () => Limit.perSeconds(1, 60));

        router.get('/x', respondOk).middleware('throttle:sig');
        router.get('/y', respondOk).middleware('throttle:sig');
      });

      expect((await request('GET', '/x')).status).toBe(200);
      expect((await request('GET', '/x')).status).toBe(429);

      // A different route has its own signature, so its window starts fresh
      expect((await request('GET', '/y')).status).toBe(200);
    });
  });

  describe('authentication integration', () => {
    it('keys the limiter by the authenticated user id, not the shared IP', async () => {
      let current: Authenticatable | null = fakeUser('ada');

      const { request } = await createHarness(({ limiter, router }) => {
        limiter.define('api', () => Limit.perSeconds(1, 60));

        router.get('/x', respondOk).middleware([bindUser(() => current), 'throttle:api']);
      });

      expect((await request('GET', '/x')).status).toBe(200);
      expect((await request('GET', '/x')).status).toBe(429);

      // A second user behind the same IP gets their own window
      current = fakeUser('grace');

      expect((await request('GET', '/x')).status).toBe(200);

      // ...and ada is still blocked once grace's request is through
      current = fakeUser('ada');

      expect((await request('GET', '/x')).status).toBe(429);
    });

    it('keys numeric throttles by user id as well', async () => {
      let current: Authenticatable | null = fakeUser(42);

      const { request } = await createHarness(({ router }) => {
        router.get('/x', respondOk).middleware([bindUser(() => current), 'throttle:1,1']);
      });

      expect((await request('GET', '/x')).status).toBe(200);
      expect((await request('GET', '/x')).status).toBe(429);

      // Same identity from a different session object: same window
      current = fakeUser(42);

      expect((await request('GET', '/x')).status).toBe(429);
    });

    it('separates guests by IP address', async () => {
      const { request } = await createHarness(({ router }) => {
        router.get('/x', respondOk).middleware('throttle:1,1');
      });

      // Guests are keyed by their real socket address; forwarded headers
      // without a trust boundary are not (see the TrustProxies suite)
      expect((await request('GET', '/x', {}, '10.0.0.1')).status).toBe(200);
      expect((await request('GET', '/x', {}, '10.0.0.1')).status).toBe(429);
      expect((await request('GET', '/x', {}, '10.0.0.2')).status).toBe(200);
    });
  });

  describe('RateLimiter facade', () => {
    it('defines named limiters statically and counts through the container limiter', async () => {
      const { limiter } = await createHarness(({ router }) => {
        RateLimiterFacade.define('api', () => Limit.perSeconds(2, 60));

        router.get('/x', respondOk).middleware('throttle:api');
      });

      expect(limiter.has('api')).toBe(true);
      expect(await RateLimiterFacade.attempts('untouched')).toBe(0);

      expect(await RateLimiterFacade.hit('manual', 2)).toBe(false);
      expect(await RateLimiterFacade.remaining('manual', 2)).toBe(1);
      expect(await RateLimiterFacade.hit('manual', 2)).toBe(true);
      expect(await RateLimiterFacade.tooManyAttempts('manual', 2)).toBe(true);
      expect(await RateLimiterFacade.availableIn('manual')).toBe(60);

      await RateLimiterFacade.clear('manual');

      expect(await RateLimiterFacade.tooManyAttempts('manual', 2)).toBe(false);
      expect(await RateLimiterFacade.availableIn('manual')).toBe(0);
    });

    it('handles the attempt callback through the facade', async () => {
      await createHarness();

      const result = await RateLimiterFacade.attempt('task', 1, () => 'ran');

      expect(result).toBe('ran');
      expect(await RateLimiterFacade.attempt('task', 1, () => 'ran again')).toBe(false);
    });
  });
});
