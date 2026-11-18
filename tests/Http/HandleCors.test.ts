/**
 * CORS - the CorsPolicy calculation and the HandleCors middleware
 *
 * Policy unit tests cover origin matching and the credentials rules; the
 * middleware tests drive full Kernel round trips with CorsServiceProvider
 * registered, checking preflight 204 answers, allow/deny headers and the
 * `cors` configuration defaults.
 */

import { captureResponse, createRawRequest } from '@tests/Session/support';
import { describe, expect, it } from 'vitest';
import type { CorsConfig } from '@/Http/Middleware/CorsPolicy';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { Kernel } from '@/Foundation/Http/Kernel';
import { CorsPolicy, DEFAULT_CORS_CONFIG, resolveCorsConfig } from '@/Http/Middleware/CorsPolicy';
import { CorsServiceProvider } from '@/Http/Middleware/CorsServiceProvider';
import { Request } from '@/Routing/Request';
import { Response } from '@/Routing/Response';
import { Router } from '@/Routing/Router';

function makeRequest(method: string, url: string, headers: Record<string, string> = {}): Request {
  return new Request(createRawRequest(method, url, { headers }));
}

function policy(options: Partial<CorsConfig>): CorsPolicy {
  return new CorsPolicy(resolveCorsConfig(options));
}

describe('CorsPolicy', () => {
  describe('origin matching', () => {
    it('matches exact origins case-insensitively', () => {
      const cors = policy({ allowed_origins: ['https://App.test'] });

      expect(cors.isOriginAllowed('https://app.test')).toBe(true);
      expect(cors.isOriginAllowed('https://evil.test')).toBe(false);
    });

    it('matches the * wildcard against any origin', () => {
      const cors = policy({ allowed_origins: ['*'] });

      expect(cors.isOriginAllowed('https://anything.test')).toBe(true);
      expect(cors.isOriginAllowed('http://localhost:3000')).toBe(true);
    });

    it('matches wildcard patterns like https://*.app.test', () => {
      const cors = policy({ allowed_origins: ['https://*.app.test'] });

      expect(cors.isOriginAllowed('https://api.app.test')).toBe(true);
      expect(cors.isOriginAllowed('https://app.test')).toBe(false);
      expect(cors.isOriginAllowed('https://api.evil.test')).toBe(false);
      expect(cors.isOriginAllowed('http://api.app.test')).toBe(false);
    });

    it('answers concrete origins for pattern matches', () => {
      const cors = policy({ allowed_origins: ['https://*.app.test'] });
      const request = makeRequest('GET', '/x', { origin: 'https://api.app.test' });

      expect(cors.allowedOriginFor(request)).toBe('https://api.app.test');
    });
  });

  describe('wildcard and credentials', () => {
    it('reflects * only when credentials are off', () => {
      const anonymous = policy({ allowed_origins: ['*'] });
      const request = makeRequest('GET', '/x', { origin: 'https://app.test' });

      expect(anonymous.allowedOriginFor(request)).toBe('*');
    });

    it('never reflects * together with credentials', () => {
      const cors = policy({ allowed_origins: ['*'], supports_credentials: true });
      const request = makeRequest('GET', '/x', { origin: 'https://app.test' });

      expect(cors.allowedOriginFor(request)).toBe('https://app.test');
      expect(cors.actualRequestHeaders(request)['Access-Control-Allow-Origin']).toBe('https://app.test');
      expect(cors.actualRequestHeaders(request)['Access-Control-Allow-Credentials']).toBe('true');
    });

    it('spells out the methods for a credentialed wildcard preflight', () => {
      const cors = policy({ allowed_origins: ['*'], supports_credentials: true });
      const request = makeRequest('OPTIONS', '/x', {
        origin: 'https://app.test',
        'access-control-request-method': 'POST',
      });

      expect(cors.preflightHeaders(request)['Access-Control-Allow-Methods']).not.toBe('*');
      expect(cors.preflightHeaders(request)['Access-Control-Allow-Methods']).toContain('POST');
    });
  });

  describe('preflight answers', () => {
    it('advertises configured methods, headers and max age', () => {
      const cors = policy({
        allowed_origins: ['https://app.test'],
        allowed_methods: ['GET', 'POST'],
        allowed_headers: ['Content-Type', 'X-Auth'],
        max_age: 600,
      });

      const request = makeRequest('OPTIONS', '/x', {
        origin: 'https://app.test',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, x-other',
      });

      const headers = cors.preflightHeaders(request);

      expect(headers['Access-Control-Allow-Origin']).toBe('https://app.test');
      expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST');
      // The requested set is filtered through the allow-list
      expect(headers['Access-Control-Allow-Headers']).toBe('content-type');
      expect(headers['Access-Control-Max-Age']).toBe('600');
    });

    it('echoes the requested headers when the allow-list is *', () => {
      const cors = policy({ allowed_headers: ['*'] });
      const request = makeRequest('OPTIONS', '/x', {
        origin: 'https://anything.test',
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'X-Trace, Content-Type',
      });

      expect(cors.preflightHeaders(request)['Access-Control-Allow-Headers']).toBe('X-Trace, Content-Type');
    });

    it('omits max age when zero and answers nothing for disallowed origins', () => {
      const cors = policy({ allowed_origins: ['https://app.test'] });
      const preflight = makeRequest('OPTIONS', '/x', {
        origin: 'https://app.test',
        'access-control-request-method': 'POST',
      });

      expect(cors.preflightHeaders(preflight)['Access-Control-Max-Age']).toBeUndefined();
      expect(
        cors.preflightHeaders(
          makeRequest('OPTIONS', '/x', {
            origin: 'https://evil.test',
            'access-control-request-method': 'POST',
          })
        )
      ).toEqual({});
    });
  });

  describe('request classification', () => {
    it('recognises CORS and preflight requests by their headers', () => {
      const cors = policy({});

      expect(cors.isCorsRequest(makeRequest('GET', '/x'))).toBe(false);
      expect(cors.isCorsRequest(makeRequest('GET', '/x', { origin: 'https://app.test' }))).toBe(true);

      expect(cors.isPreflightRequest(makeRequest('GET', '/x', { origin: 'https://app.test' }))).toBe(false);
      expect(cors.isPreflightRequest(makeRequest('OPTIONS', '/x', { origin: 'https://app.test' }))).toBe(false);
      expect(
        cors.isPreflightRequest(
          makeRequest('OPTIONS', '/x', { origin: 'https://app.test', 'access-control-request-method': 'POST' })
        )
      ).toBe(true);
    });

    it('adds exposed response headers when configured', () => {
      const cors = policy({ exposed_headers: ['X-Pagination', 'X-Total'] });
      const request = makeRequest('GET', '/x', { origin: 'https://anything.test' });

      expect(cors.actualRequestHeaders(request)['Access-Control-Expose-Headers']).toBe('X-Pagination, X-Total');
    });

    it('answers no headers for disallowed origins', () => {
      const cors = policy({ allowed_origins: ['https://app.test'] });
      const request = makeRequest('GET', '/x', { origin: 'https://evil.test' });

      expect(cors.actualRequestHeaders(request)).toEqual({});
    });
  });

  describe('resolveCorsConfig', () => {
    it('falls back to the framework defaults for missing sections', () => {
      expect(resolveCorsConfig(undefined)).toEqual(DEFAULT_CORS_CONFIG);
      expect(resolveCorsConfig('nonsense')).toEqual(DEFAULT_CORS_CONFIG);
    });

    it('merges partial configuration over the defaults', () => {
      const resolved = resolveCorsConfig({ allowed_origins: 'https://app.test', max_age: 30 });

      expect(resolved.allowed_origins).toEqual(['https://app.test']);
      expect(resolved.max_age).toBe(30);
      expect(resolved.allowed_methods).toEqual(DEFAULT_CORS_CONFIG.allowed_methods);
      expect(resolved.supports_credentials).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// HTTP-level behaviour through the Kernel stack
// ---------------------------------------------------------------------------

interface Harness {
  app: Application;
  kernel: Kernel;
  request(
    method: string,
    url: string,
    headers?: Record<string, string>
  ): Promise<{
    status: number;
    body: string;
    headers: Record<string, string>;
  }>;
}

async function corsApp(cors: Partial<CorsConfig> = {}): Promise<Harness> {
  const app = new Application('/test');

  app.instance('config', new Config({ cors }));

  const router = new Router(app);
  app.singleton('router', () => router);

  const kernel = new Kernel(app);
  app.instance('kernel', kernel);

  app.register(CorsServiceProvider);

  await app.boot();

  router.get('/data', (_req: Request, res: Response) => res.send('payload'));

  async function request(method: string, url: string, headers: Record<string, string> = {}) {
    const { raw, chunks, headers: sentHeaders } = captureResponse();

    await kernel.handle(createRawRequest(method, url, { headers }), raw);

    return { status: raw.statusCode, body: chunks.join(''), headers: sentHeaders };
  }

  return { app, kernel, request };
}

describe('HandleCors middleware', () => {
  it('registers the cors configuration with framework defaults', async () => {
    const { app } = await corsApp({ allowed_origins: ['https://app.test'] });

    const config = app.make<Config>('config');

    expect(config.get('cors.allowed_origins')).toEqual(['https://app.test']);
    expect(config.get('cors.allowed_methods')).toEqual(['*']);
    expect(config.get('cors.supports_credentials')).toBe(false);
    expect(config.get('cors.exposed_headers')).toEqual([]);
  });

  it('answers allowed origins with Access-Control-Allow-Origin', async () => {
    const { request } = await corsApp({ allowed_origins: ['https://app.test'] });

    const allowed = await request('GET', '/data', { origin: 'https://app.test' });

    expect(allowed.status).toBe(200);
    expect(allowed.headers['Access-Control-Allow-Origin']).toBe('https://app.test');
  });

  it('withholds CORS headers from disallowed origins', async () => {
    const { request } = await corsApp({ allowed_origins: ['https://app.test'] });

    const denied = await request('GET', '/data', { origin: 'https://evil.test' });

    expect(denied.status).toBe(200);
    expect(denied.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(denied.headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('sends no CORS headers for same-origin (header-less) requests', async () => {
    const { request } = await corsApp();

    const plain = await request('GET', '/data');

    expect(plain.status).toBe(200);
    expect(plain.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('answers a preflight with 204 and the configured methods, headers and max age', async () => {
    const { request } = await corsApp({
      allowed_origins: ['https://app.test'],
      allowed_methods: ['GET', 'POST', 'PATCH'],
      allowed_headers: ['Content-Type', 'X-Api-Key'],
      max_age: 7200,
    });

    const preflight = await request('OPTIONS', '/data', {
      origin: 'https://app.test',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'Content-Type, X-Api-Key',
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers['Access-Control-Allow-Origin']).toBe('https://app.test');
    expect(preflight.headers['Access-Control-Allow-Methods']).toBe('GET, POST, PATCH');
    expect(preflight.headers['Access-Control-Allow-Headers']).toBe('Content-Type, X-Api-Key');
    expect(preflight.headers['Access-Control-Max-Age']).toBe('7200');
  });

  it('does not route the preflight to an OPTIONS handler', async () => {
    const { request } = await corsApp();

    // No OPTIONS route exists, yet the wildcard preflight still succeeds
    const preflight = await request('OPTIONS', '/data', {
      origin: 'https://anywhere.test',
      'access-control-request-method': 'DELETE',
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  it('passes a disallowed preflight on to the router, unanswered', async () => {
    const { request } = await corsApp({ allowed_origins: ['https://app.test'] });

    const preflight = await request('OPTIONS', '/data', {
      origin: 'https://evil.test',
      'access-control-request-method': 'POST',
    });

    // The router's automatic OPTIONS answer (an Allow-bearing 204) still
    // arrives, but with no CORS grant for the disallowed origin
    expect(preflight.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(preflight.status).toBe(204);
  });

  it('supports credentials with wildcard configuration without ever reflecting *', async () => {
    const { request } = await corsApp({ allowed_origins: ['*'], supports_credentials: true });

    const actual = await request('GET', '/data', { origin: 'https://app.test' });

    expect(actual.headers['Access-Control-Allow-Origin']).toBe('https://app.test');
    expect(actual.headers['Access-Control-Allow-Origin']).not.toBe('*');
    expect(actual.headers['Access-Control-Allow-Credentials']).toBe('true');

    const preflight = await request('OPTIONS', '/data', {
      origin: 'https://app.test',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'Authorization',
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers['Access-Control-Allow-Origin']).toBe('https://app.test');
    expect(preflight.headers['Access-Control-Allow-Credentials']).toBe('true');
    expect(preflight.headers['Access-Control-Allow-Headers']).toBe('Authorization');
  });

  it('exposes configured response headers on actual requests', async () => {
    const { request } = await corsApp({ exposed_headers: ['X-Total'] });

    const response = await request('GET', '/data', { origin: 'https://app.test' });

    expect(response.headers['Access-Control-Expose-Headers']).toBe('X-Total');
  });

  it('registers the middleware exactly once into the global stack', async () => {
    const app = new Application('/test');

    app.instance('config', new Config({ cors: {} }));

    const router = new Router(app);
    app.singleton('router', () => router);

    const kernel = new Kernel(app);
    app.instance('kernel', kernel);

    app.register(CorsServiceProvider);

    await app.boot();
    await kernel.getApplication().boot();

    // Re-registering boots it again: the stack must not carry CORS twice
    app.register(CorsServiceProvider);

    expect(kernel.getMiddleware().filter((entry) => typeof entry === 'function')).toHaveLength(1);
  });
});
