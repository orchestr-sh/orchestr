/**
 * HTTP client - verbs, headers/auth, body formats, response API
 *
 * These tests drive the real FetchTransport against a loopback server so
 * the wire behaviour (JSON/form/multipart bodies, auth headers, sinks,
 * custom transports) is pinned, not just the fluent plumbing.
 */

import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Transport, TransportRequest, TransportResponse } from '@/Http/Client/Contracts/Transport';
import { Http } from '@/Facades/Http';
import { defaultFactory } from '@/Http/Client/Factory';
import { FetchTransport } from '@/Http/Client/Transports/FetchTransport';
import { HttpTestServer, echo, reply } from './support';

let server: HttpTestServer;

beforeEach(async () => {
  server = new HttpTestServer();
  await server.start();
});

afterEach(async () => {
  Http.stopFaking();
  Http.setTransport(null);
  await server.stop();
});

describe('verbs', () => {
  it('sends every verb with the right method', async () => {
    await Http.get(server.url('/a'));
    await Http.post(server.url('/b'), { x: 1 });
    await Http.put(server.url('/c'), { x: 2 });
    await Http.patch(server.url('/d'), { x: 3 });
    await Http.delete(server.url('/e'));
    await Http.head(server.url('/f'));
    await Http.options(server.url('/g'));

    expect(server.requests.map((request) => request.method)).toEqual([
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS',
    ]);
  });

  it('acceptance: get() then json() reads the parsed body', async () => {
    const response = await Http.withToken('x').get(server.url('/me'));

    expect(response.json('method')).toBe('GET');
  });

  it('merges query parameters onto GET urls', async () => {
    await Http.get(server.url('/search'), { q: 'orchestr', page: 2 });

    expect(server.lastRequest().url).toBe('/search?q=orchestr&page=2');
  });

  it('sends a body for DELETE only when data is given, like Laravel', async () => {
    await Http.delete(server.url('/nothing'));
    await Http.delete(server.url('/something'), { id: 4 });

    expect(server.requests[0].body).toBe('');
    expect(JSON.parse(server.requests[1].body)).toEqual({ id: 4 });
  });
});

describe('headers, auth and cookies', () => {
  it('withHeaders sends them; names are matched case-insensitively', async () => {
    await Http.withHeaders({ 'X-Custom': 'yes', 'x-other': 1 }).get(server.url('/'));

    expect(server.lastRequest().headers['x-custom']).toBe('yes');
    expect(server.lastRequest().headers['x-other']).toBe('1');
  });

  it('withToken sends a Bearer token (and custom schemes)', async () => {
    await Http.withToken('secret').get(server.url('/'));
    await Http.withToken('key', 'Token').get(server.url('/'));

    expect(server.requests[0].headers.authorization).toBe('Bearer secret');
    expect(server.requests[1].headers.authorization).toBe('Token key');
  });

  it('withBasicAuth sends the base64 credentials', async () => {
    await Http.withBasicAuth('sam', 'hunter2').get(server.url('/'));

    expect(server.lastRequest().headers.authorization).toBe(`Basic ${Buffer.from('sam:hunter2').toString('base64')}`);
  });

  it('withCookies sends a Cookie header', async () => {
    await Http.withCookies({ theme: 'dark', sid: 'a b' }, '127.0.0.1').get(server.url('/'));

    expect(server.lastRequest().headers.cookie).toBe('theme=dark; sid=a%20b');
  });

  it('acceptJson sets the Accept header', async () => {
    await Http.acceptJson().get(server.url('/'));

    expect(server.lastRequest().headers.accept).toBe('application/json');
  });

  it('withDigestAuth answers the server digest challenge within one attempt', async () => {
    const nonce = 'abc123';

    server.responder = (request, res) => {
      if (!request.headers.authorization) {
        res.writeHead(401, {
          'WWW-Authenticate': `Digest realm="test", qop="auth", nonce="${nonce}", opaque="xyz"`,
        });
        res.end();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"authorized":true}');
    };

    const response = await Http.withDigestAuth('sam', 'secret').get(server.url('/private'));

    expect(response.status()).toBe(200);
    expect(server.requests).toHaveLength(2);

    // The client must compute the RFC 2617 digest response itself;
    // recompute it from the header's nonce/cnonce to verify.
    const authorization = server.lastRequest().headers.authorization as string;

    const param = (name: string): string => authorization.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';

    expect(authorization.startsWith('Digest ')).toBe(true);
    expect(param('username')).toBe('sam');
    expect(param('realm')).toBe('test');
    expect(param('nonce')).toBe(nonce);
    expect(authorization).toContain('qop=auth');
    expect(authorization).toContain('nc=00000001');

    const url = new URL(server.url('/private'));
    const md5 = (value: string) => createHash('md5').update(value).digest('hex');
    const ha1 = md5(`sam:test:secret`);
    const ha2 = md5(`GET:${url.pathname}${url.search}`);
    const expected = md5(`${ha1}:${nonce}:00000001:${param('cnonce')}:auth:${ha2}`);

    expect(param('response')).toBe(expected);
  });
});

describe('body formats', () => {
  it('acceptance: post() sends JSON by default', async () => {
    await Http.post(server.url('/users'), { a: 1 });

    expect(server.lastRequest().headers['content-type']).toBe('application/json');
    expect(JSON.parse(server.lastRequest().body)).toEqual({ a: 1 });
  });

  it('acceptance: asForm sends urlencoded form data', async () => {
    await Http.asForm().post(server.url('/login'), { email: 'ada@example.com', name: 'Ada L' });

    expect(server.lastRequest().headers['content-type']).toBe('application/x-www-form-urlencoded');

    const form = new URLSearchParams(server.lastRequest().body);

    expect(form.get('email')).toBe('ada@example.com');
    expect(form.get('name')).toBe('Ada L');
  });

  it('asForm nests objects and arrays with bracket notation', async () => {
    await Http.asForm().post(server.url('/'), { profile: { city: 'NY' }, tags: ['a', 'b'] });

    const form = new URLSearchParams(server.lastRequest().body);

    expect(form.get('profile[city]')).toBe('NY');
    expect(form.getAll('tags[]')).toEqual(['a', 'b']);
  });

  it('attach() encodes a multipart body with fields and file parts', async () => {
    const response = await Http.attach('photo', '<svg/>', 'logo.svg', { 'Content-Type': 'image/svg+xml' }).post(
      server.url('/upload'),
      { caption: 'hi' }
    );

    expect(response.status()).toBe(200);

    const contentType = server.lastRequest().headers['content-type'] as string;

    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);

    const boundary = contentType.split('boundary=')[1];

    expect(server.lastRequest().body).toContain(`--${boundary}`);
    expect(server.lastRequest().body).toContain('name="caption"');
    expect(server.lastRequest().body).toContain('name="photo"; filename="logo.svg"');
    expect(server.lastRequest().body).toContain('Content-Type: image/svg+xml');
  });

  it('withBody sends the raw content with the declared type', async () => {
    await Http.withBody('<hello/>', 'application/xml').post(server.url('/'));

    expect(server.lastRequest().headers['content-type']).toBe('application/xml');
    expect(server.lastRequest().body).toBe('<hello/>');
  });
});

describe('response API', () => {
  it('reports status ranges through ok/successful/failed/clientError/serverError', async () => {
    server.responder = reply('nope', 404);
    const notFound = await Http.get(server.url('/missing'));

    expect(notFound.status()).toBe(404);
    expect(notFound.ok()).toBe(false);
    expect(notFound.successful()).toBe(false);
    expect(notFound.failed()).toBe(true);
    expect(notFound.clientError()).toBe(true);
    expect(notFound.serverError()).toBe(false);

    server.responder = reply('boom', 503);
    const bad = await Http.get(server.url('/down'));

    expect(bad.serverError()).toBe(true);

    server.responder = reply('ok', 200);
    const good = await Http.get(server.url('/up'));

    expect(good.ok()).toBe(true);
    expect(good.successful()).toBe(true);
  });

  it('exposes text/body, headers and header lookups', async () => {
    server.responder = (_request, res) => {
      res.writeHead(201, { 'X-Thing': 'value', 'Content-Type': 'text/plain' });
      res.end('hello world');
    };

    const response = await Http.get(server.url('/greet'));

    expect(response.text()).toBe('hello world');
    expect(response.body()).toBe('hello world');
    expect(response.header('x-thing')).toBe('value');
    expect(response.header('X-Thing')).toBe('value');
    expect(response.header('nope')).toBeNull();
    expect(response.headers()['content-type']).toBe('text/plain');
  });

  it('json reads with dot notation and defaults; object/collect wrap the body', async () => {
    server.responder = reply({ data: { user: { name: 'Ada' }, tags: ['x', 'y'] } });

    const response = await Http.get(server.url('/api'));

    expect(response.json('data.user.name')).toBe('Ada');
    expect(response.json('data.user.age', 'unknown')).toBe('unknown');
    expect(response.json('nope')).toBeNull();
    expect(response.object()).toEqual({ data: { user: { name: 'Ada' }, tags: ['x', 'y'] } });
    expect(response.collect('data.tags').all()).toEqual(['x', 'y']);
    expect(response.collect().get('data')?.user.name).toBe('Ada');
  });

  it('json tolerates non-JSON bodies', async () => {
    server.responder = reply('plain text', 200);

    const response = await Http.get(server.url('/'));

    expect(response.json()).toBeNull();
    expect(response.json('key', 'fallback')).toBe('fallback');
  });

  it('sink writes the response body to disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orchestr-http-'));
    const target = join(dir, 'download.txt');

    server.responder = reply('saved contents', 200);

    try {
      await Http.sink(target).get(server.url('/file'));

      expect(readFileSync(target, 'utf8')).toBe('saved contents');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('transports', () => {
  it('fetch is the default transport', () => {
    expect(defaultFactory().getTransport()).toBeInstanceOf(FetchTransport);
  });

  it('acceptance: a custom adapter behind the Transport contract takes over', async () => {
    const seen: TransportRequest[] = [];

    const custom: Transport = {
      async send(request): Promise<TransportResponse> {
        seen.push(request);

        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: new TextEncoder().encode(JSON.stringify({ echoed: request.url })),
        };
      },
    };

    Http.setTransport(custom);

    const response = await Http.withToken('abc').post(server.url('/through-custom'), { go: true });

    expect(response.json('echoed')).toBe(server.url('/through-custom'));
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].headers.authorization).toBe('Bearer abc');
    expect(JSON.parse(seen[0].body as string)).toEqual({ go: true });

    // setTransport(null) restores the built-in fetch transport.
    Http.setTransport(null);

    expect(defaultFactory().getTransport()).toBeInstanceOf(FetchTransport);

    server.responder = echo;

    expect((await Http.get(server.url('/real'))).json('url')).toBe('/real');
  });

  it('withOptions passes fetch-level options through to the transport', async () => {
    server.responder = (_request, res) => {
      res.writeHead(302, { Location: server.url('/landed') });
      res.end();
    };

    // Fetch follows redirects by default; the passthrough opts out.
    const redirected = await Http.withOptions({ redirect: 'manual' }).get(server.url('/start'));

    expect(redirected.status()).toBe(302);
    expect(server.requests.map((request) => request.url)).toEqual(['/start']);
  });
});
