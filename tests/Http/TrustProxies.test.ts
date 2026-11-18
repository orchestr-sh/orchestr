/**
 * Trusted proxies - the TrustedProxyResolver rules and the TrustProxies
 * middleware
 *
 * Resolver unit tests cover the wildcard, exact addresses, IPv4/IPv6 CIDR
 * blocks and the header trust set. The middleware tests drive full Kernel
 * round trips with TrustProxiesServiceProvider registered: from a trusted
 * proxy X-Forwarded-For/Proto/Host/Port shape ip(), ips(), isSecure(),
 * scheme(), host() and port(); from anywhere else those headers are
 * ignored and the socket answers.
 */

import { captureResponse, createRawRequest } from '@tests/Session/support';
import { describe, expect, it } from 'vitest';
import type { TrustedProxyConfig } from '@/Http/Middleware/TrustedProxyResolver';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { Kernel } from '@/Foundation/Http/Kernel';
import {
  DEFAULT_TRUSTED_PROXY_CONFIG,
  resolveTrustedProxyConfig,
  TrustedProxyResolver,
} from '@/Http/Middleware/TrustedProxyResolver';
import { TrustProxiesServiceProvider } from '@/Http/Middleware/TrustProxiesServiceProvider';
import { Request } from '@/Routing/Request';
import { Response } from '@/Routing/Response';
import { Router } from '@/Routing/Router';

function resolver(options: Partial<TrustedProxyConfig>): TrustedProxyResolver {
  return new TrustedProxyResolver(resolveTrustedProxyConfig(options));
}

function makeRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  remoteAddress?: string
): Request {
  return new Request(createRawRequest(method, url, { headers, remoteAddress }));
}

describe('TrustedProxyResolver', () => {
  describe('source matching', () => {
    it('trusts nobody by default', () => {
      const trust = resolver({});

      expect(trust.isTrustedProxy('203.0.113.10')).toBe(false);
      expect(trust.isTrustedProxy('10.0.0.1')).toBe(false);
      expect(trust.isTrustedProxy(undefined)).toBe(false);
    });

    it('trusts every source with the * wildcard, including unknown sockets', () => {
      const trust = resolver({ proxies: ['*'] });

      expect(trust.isTrustedProxy('203.0.113.10')).toBe(true);
      expect(trust.isTrustedProxy('::1')).toBe(true);
      expect(trust.isTrustedProxy(undefined)).toBe(true);
    });

    it('matches exact IPv4 and IPv6 addresses', () => {
      const trust = resolver({ proxies: ['203.0.113.10', '::1'] });

      expect(trust.isTrustedProxy('203.0.113.10')).toBe(true);
      expect(trust.isTrustedProxy('203.0.113.11')).toBe(false);
      expect(trust.isTrustedProxy('::1')).toBe(true);
      // The same address written out fully still matches
      expect(trust.isTrustedProxy('0:0:0:0:0:0:0:1')).toBe(true);
      expect(trust.isTrustedProxy('2001:db8::5')).toBe(false);
    });

    it('matches IPv4 CIDR blocks on the network prefix', () => {
      const trust = resolver({ proxies: ['10.0.0.0/8', '192.168.5.0/24'] });

      expect(trust.isTrustedProxy('10.1.2.3')).toBe(true);
      expect(trust.isTrustedProxy('10.255.255.255')).toBe(true);
      expect(trust.isTrustedProxy('11.0.0.1')).toBe(false);
      expect(trust.isTrustedProxy('192.168.5.77')).toBe(true);
      expect(trust.isTrustedProxy('192.168.6.77')).toBe(false);
    });

    it('matches IPv6 CIDR blocks', () => {
      const trust = resolver({ proxies: ['2001:db8::/32'] });

      expect(trust.isTrustedProxy('2001:db8:99::5')).toBe(true);
      expect(trust.isTrustedProxy('2001:db9::1')).toBe(false);
    });

    it('rejects malformed sources and blocks instead of throwing', () => {
      const trust = resolver({ proxies: ['10.0.0.0/8', '::ffff:192.0.2.3', 'not-an-ip'] });

      expect(trust.isTrustedProxy('garbage')).toBe(false);
      expect(trust.isTrustedProxy('999.1.1.1')).toBe(false);
      expect(trust.isTrustedProxy('10.0.0.7')).toBe(true);
      expect(trust.isTrustedProxy('192.0.2.3')).toBe(true);
      // An IPv4 source is never inside an IPv6 block
      expect(resolver({ proxies: ['2001:db8::/32'] }).isTrustedProxy('10.0.0.7')).toBe(false);
    });
  });

  describe('header trust set', () => {
    it('honours the configured headers case-insensitively', () => {
      const trust = resolver({ headers: ['X-Forwarded-For', 'x-forwarded-proto'] });

      expect(trust.trusts('x-forwarded-for')).toBe(true);
      expect(trust.trusts('X-Forwarded-Proto')).toBe(true);
      expect(trust.trusts('x-forwarded-host')).toBe(false);
      expect(trust.trusts('x-forwarded-port')).toBe(false);
    });
  });
});

describe('resolveTrustedProxyConfig', () => {
  it('falls back to the framework defaults for missing sections', () => {
    expect(resolveTrustedProxyConfig(undefined)).toEqual(DEFAULT_TRUSTED_PROXY_CONFIG);
    expect(resolveTrustedProxyConfig('nonsense')).toEqual(DEFAULT_TRUSTED_PROXY_CONFIG);
  });

  it('merges partial configuration over the defaults', () => {
    const resolved = resolveTrustedProxyConfig({ proxies: '*', headers: ['X-Forwarded-For'] });

    expect(resolved.proxies).toEqual(['*']);
    expect(resolved.headers).toEqual(['x-forwarded-for']);
  });

  it('keeps the default header set when none is configured', () => {
    expect(resolveTrustedProxyConfig({ proxies: ['203.0.113.10'] }).headers).toEqual(
      DEFAULT_TRUSTED_PROXY_CONFIG.headers
    );
  });
});

// ---------------------------------------------------------------------------
// Request-level resolution
// ---------------------------------------------------------------------------

describe('Request forwarded values', () => {
  const forwardedHeaders = {
    'x-forwarded-for': '198.51.100.7',
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'app.test',
    'x-forwarded-port': '8443',
  };

  it('ignores forwarded headers entirely without a trust boundary', () => {
    const request = makeRequest('GET', '/x', forwardedHeaders, '203.0.113.99');

    expect(request.ip()).toBe('203.0.113.99');
    expect(request.ips()).toEqual(['203.0.113.99']);
    expect(request.isSecure()).toBe(false);
    expect(request.scheme()).toBe('http');
    expect(request.host()).toBeUndefined(); // no Host header either
    expect(request.port()).toBe(80);
  });

  it('ignores forwarded headers from an untrusted source', () => {
    const request = makeRequest('GET', '/x', forwardedHeaders, '203.0.113.99');
    request.setTrustedProxies(resolver({ proxies: ['10.0.0.0/8'] }));

    expect(request.ip()).toBe('203.0.113.99');
    expect(request.scheme()).toBe('http');
  });

  it('resolves ip, scheme, host and port from a trusted source', () => {
    const request = makeRequest('GET', '/x', { ...forwardedHeaders, host: 'origin.internal:8080' }, '10.1.2.3');
    request.setTrustedProxies(resolver({ proxies: ['10.0.0.0/8'] }));

    expect(request.ip()).toBe('198.51.100.7');
    expect(request.ips()).toEqual(['198.51.100.7']);
    expect(request.isSecure()).toBe(true);
    expect(request.scheme()).toBe('https');
    expect(request.host()).toBe('app.test');
    expect(request.port()).toBe(8443);
  });

  it('falls back to the Host header and socket port when nothing is forwarded', () => {
    const request = makeRequest('GET', '/x', { host: 'app.test:3000' }, '10.1.2.3');
    request.setTrustedProxies(resolver({ proxies: ['10.0.0.0/8'] }));

    expect(request.host()).toBe('app.test');
    expect(request.port()).toBe(3000);
  });

  it('strips ports from forwarded hosts, IPv6 literals included', () => {
    const request = makeRequest('GET', '/x', { 'x-forwarded-host': '[2001:db8::1]:8443' }, '::1');
    request.setTrustedProxies(resolver({ proxies: ['*'] }));

    expect(request.host()).toBe('2001:db8::1');
  });

  it('walks a spoofed X-Forwarded-For chain from the closest hop', () => {
    // A client forged `203.0.113.99`; the trusted load balancer appended the
    // real address, so the right-most untrusted hop is the client
    const request = makeRequest('GET', '/x', { 'x-forwarded-for': '203.0.113.99, 198.51.100.7' }, '203.0.113.10');
    request.setTrustedProxies(resolver({ proxies: ['203.0.113.10'] }));

    expect(request.ip()).toBe('198.51.100.7');
    expect(request.ips()).toEqual(['203.0.113.99', '198.51.100.7']);
  });

  it('skips trusted intermediate proxies out of the chain', () => {
    const request = makeRequest('GET', '/x', { 'x-forwarded-for': '198.51.100.7, 10.9.9.9' }, '10.1.1.1');
    request.setTrustedProxies(resolver({ proxies: ['10.0.0.0/8'] }));

    expect(request.ip()).toBe('198.51.100.7');
  });

  it('takes the chain head when every hop is trusted', () => {
    const request = makeRequest('GET', '/x', { 'x-forwarded-for': '203.0.113.5, 198.51.100.7' }, '10.0.0.1');
    request.setTrustedProxies(resolver({ proxies: ['*'] }));

    expect(request.ip()).toBe('203.0.113.5');
  });

  it('honours only the headers in the configured trust set', () => {
    const request = makeRequest('GET', '/x', forwardedHeaders, '10.1.2.3');
    request.setTrustedProxies(resolver({ proxies: ['10.0.0.0/8'], headers: ['x-forwarded-for'] }));

    expect(request.ip()).toBe('198.51.100.7');
    expect(request.scheme()).toBe('http');
    expect(request.host()).toBeUndefined();
    expect(request.port()).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// HTTP-level behaviour through the Kernel stack
// ---------------------------------------------------------------------------

interface Harness {
  app: Application;
  kernel: Kernel;
  request(method: string, url: string, headers?: Record<string, string>, remoteAddress?: string): Promise<any>;
}

async function trustApp(trustedproxy: Partial<TrustedProxyConfig> = {}): Promise<Harness> {
  const app = new Application('/test');

  app.instance('config', new Config({ trustedproxy }));

  const router = new Router(app);
  app.singleton('router', () => router);

  const kernel = new Kernel(app);
  app.instance('kernel', kernel);

  app.register(TrustProxiesServiceProvider);

  await app.boot();

  // The route echoes what the request thinks about its client, so the
  // middleware's trust decisions surface in the JSON body
  router.get('/whoami', (req: Request, res: Response) => {
    res.send({
      ip: req.ip(),
      ips: req.ips(),
      secure: req.isSecure(),
      scheme: req.scheme(),
      host: req.host(),
      port: req.port(),
    });
  });

  async function request(method: string, url: string, headers: Record<string, string> = {}, remoteAddress?: string) {
    const { raw, chunks } = captureResponse();

    await kernel.handle(createRawRequest(method, url, { headers, remoteAddress }), raw);

    return JSON.parse(chunks.join(''));
  }

  return { app, kernel, request };
}

describe('TrustProxies middleware', () => {
  it('registers the trustedproxy configuration with framework defaults', async () => {
    const { app } = await trustApp({ proxies: ['203.0.113.10'] });

    const config = app.make<Config>('config');

    expect(config.get('trustedproxy.proxies')).toEqual(['203.0.113.10']);
    expect(config.get('trustedproxy.headers')).toEqual(DEFAULT_TRUSTED_PROXY_CONFIG.headers);
  });

  it('puts the middleware at the front of the global stack', async () => {
    const { kernel } = await trustApp();

    expect(kernel.getMiddleware().filter((entry) => typeof entry === 'function')).toHaveLength(1);
  });

  it('lets a trusted proxy set the resolved ip', async () => {
    const { request } = await trustApp({ proxies: ['203.0.113.10'] });

    const seen = await request('GET', '/whoami', { 'x-forwarded-for': '198.51.100.7' }, '203.0.113.10');

    expect(seen.ip).toBe('198.51.100.7');
  });

  it('ignores forwarded headers from an untrusted source', async () => {
    const { request } = await trustApp({ proxies: ['203.0.113.10'] });

    const seen = await request('GET', '/whoami', { 'x-forwarded-for': '198.51.100.7' }, '198.51.100.23');

    expect(seen.ip).toBe('198.51.100.23');
    expect(seen.scheme).toBe('http');
    expect(seen.secure).toBe(false);
  });

  it('resolves the scheme from a forwarded proto only for trusted proxies', async () => {
    const trusted = (await trustApp({ proxies: ['203.0.113.10'] })).request;

    expect((await trusted('GET', '/whoami', { 'x-forwarded-proto': 'https' }, '203.0.113.10')).scheme).toBe('https');
    expect((await trusted('GET', '/whoami', { 'x-forwarded-proto': 'https' }, '192.0.2.1')).scheme).toBe('http');
  });

  it('resolves host and port from the forwarded pair', async () => {
    const { request } = await trustApp({ proxies: ['*'] });

    const seen = await request(
      'GET',
      '/whoami',
      { 'x-forwarded-host': 'app.test', 'x-forwarded-port': '8443', host: 'internal.test:8080' },
      '198.51.100.9'
    );

    expect(seen.host).toBe('app.test');
    expect(seen.port).toBe(8443);
    expect(seen.scheme).toBe('http');
  });

  it('trusts any source under the wildcard proxy list', async () => {
    const { request } = await trustApp({ proxies: ['*'] });

    const seen = await request('GET', '/whoami', { 'x-forwarded-for': '203.0.113.5' }, '198.51.100.9');

    expect(seen.ip).toBe('203.0.113.5');
    expect(seen.ips).toEqual(['203.0.113.5']);
  });

  it('answers from the socket when no forwarded headers arrive at all', async () => {
    const { request } = await trustApp({ proxies: ['203.0.113.10'] });

    const seen = await request('GET', '/whoami', {}, '203.0.113.10');

    expect(seen.ip).toBe('203.0.113.10');
    expect(seen.host).toBeUndefined();
    expect(seen.port).toBe(80);
  });
});
