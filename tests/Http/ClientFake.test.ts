/**
 * HTTP client - Http.fake(), stubs, sequences and the assertion suite
 *
 * Http.fake() short-circuits outbound requests at the client layer (the
 * transport is never asked), records every exchange, and answers from
 * the stub table: URL patterns with `*` wildcards, canned values,
 * callbacks, and response sequences. preventStrayRequests() turns any
 * unmatched request into a failure.
 */

import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, afterEach } from 'vitest';
import { Http } from '@/Facades/Http';
import { ConnectionException } from '@/Http/Client/ConnectionException';
import { Request } from '@/Http/Client/Request';
import { Response } from '@/Http/Client/Response';

afterEach(() => {
  Http.stopFaking();
});

describe('stub forms', () => {
  it('acceptance: fake() intercepts requests; withToken(...).get(url).json() reads the stub', async () => {
    Http.fake({
      'https://api.example.com/*': { data: { name: 'Ada' } },
    });

    const response = await Http.withToken('x').get('https://api.example.com/me');

    expect(response.json('data.name')).toBe('Ada');
    expect(response.status()).toBe(200);
    Http.assertSent('https://api.example.com/me');
  });

  it('fake() with no stubs answers every request with an empty 200', async () => {
    Http.fake();

    const response = await Http.get('https://anything.test/everything');

    expect(response.status()).toBe(200);
    expect(response.body()).toBe('');
  });

  it('stub values cover text, status codes, exceptions and prepared responses', async () => {
    Http.fake({
      'https://stubs.test/text': 'plain hello',
      'https://stubs.test/status': 204,
      'https://stubs.test/response': Http.response({ deep: true }, 201, { 'X-Custom': 'yes' }),
      'https://stubs.test/envelope': { status: 400, body: { error: 'bad' }, headers: { 'X-Why': 'no' } },
    });

    const text = await Http.get('https://stubs.test/text');
    const status = await Http.get('https://stubs.test/status');
    const prepared = await Http.get('https://stubs.test/response');
    const envelope = await Http.get('https://stubs.test/envelope');

    expect(text.body()).toBe('plain hello');
    expect(status.status()).toBe(204);
    expect(prepared.json('deep')).toBe(true);
    expect(prepared.header('x-custom')).toBe('yes');
    expect(envelope.status()).toBe(400);
    expect(envelope.json('error')).toBe('bad');
    expect(envelope.header('x-why')).toBe('no');
  });

  it('callback stubs see the request and build responses from it', async () => {
    Http.fake((request) => Http.response({ echo: request.url, method: request.method }));

    const response = await Http.post('https://cb.test/things', { a: 1 });

    expect(response.json('echo')).toBe('https://cb.test/things');
    expect(response.json('method')).toBe('POST');
  });

  it('a callback returning null lets the request fall through to the next stub', async () => {
    Http.fake({
      'https://pass.test/first': null,
    });
    Http.stub((request) => (request.method === 'GET' ? Http.response('second wins') : undefined));

    const response = await Http.get('https://pass.test/first');

    expect(response.body()).toBe('second wins');
  });

  it('stub callbacks can fail the connection via failedConnection()', async () => {
    Http.fake({ 'https://dead.test/*': Http.failedConnection('host gone') });

    await expect(Http.get('https://dead.test/')).rejects.toBeInstanceOf(ConnectionException);
    await expect(Http.get('https://dead.test/')).rejects.toThrow('host gone');
    Http.assertSent('https://dead.test/');
    expect(Http.lastRecorded()?.[1]).toBeNull();
  });
});

describe('sequences', () => {
  it('fakeSequence() pops one response per request in order', async () => {
    const sequence = Http.fakeSequence('https://api.test/ping');

    sequence.pushStatus(503).pushStatus(500).push({ pong: true });

    expect((await Http.get('https://api.test/ping')).status()).toBe(503);
    expect((await Http.get('https://api.test/ping')).status()).toBe(500);
    expect((await Http.get('https://api.test/ping')).json('pong')).toBe(true);
    expect(sequence.isEmpty()).toBe(true);
    Http.assertSequencesAreEmpty();
  });

  it('an emptied sequence fails, or answers the configured default', async () => {
    const strict = Http.fakeSequence('https://strict.test/*');
    strict.push('only one');

    await Http.get('https://strict.test/');

    await expect(Http.get('https://strict.test/')).rejects.toThrow('response sequence is empty');

    Http.stopFaking();

    const lenient = Http.fakeSequence('https://lenient.test/*');
    lenient.push('first').dontFailWhenEmpty();

    expect((await Http.get('https://lenient.test/')).status()).toBe(200);
  });

  it('Http.sequence() composes stub values including exceptions', async () => {
    Http.fake({
      'https://mix.test/*': Http.sequence([Http.response('one'), new Error('stub failure')]),
    });

    expect((await Http.get('https://mix.test/')).body()).toBe('one');
    await expect(Http.get('https://mix.test/')).rejects.toThrow('stub failure');
  });
});

describe('assertions', () => {
  it('acceptance: assertSent/assertNotSent match patterns and callbacks over request+response', async () => {
    Http.fake({ 'https://api.test/*': { stored: true } });

    await Http.post('https://api.test/users', { name: 'Ada' });

    Http.assertSent('https://api.test/users');
    Http.assertSent((request) => request.method === 'POST' && request.input('name') === 'Ada');
    Http.assertSent((request, response) => request.url.endsWith('/users') && response?.json('stored') === true);
    Http.assertNotSent('https://api.test/secrets');
    Http.assertNotSent((request) => request.input('name') === 'Grace');

    expect(() => Http.assertSent('https://api.test/never')).toThrow(/not recorded/);
    expect(() => Http.assertNotSent('https://api.test/users')).toThrow(/Unexpected request/);
  });

  it('recorded requests expose headers, body and data', async () => {
    Http.fake({ 'https://api.test/*': 200 });

    await Http.withHeaders({ 'X-Trace': 'abc' }).post('https://api.test/items?page=2', { title: 'Thing' });

    const recorded = Http.recorded();

    expect(recorded.count()).toBe(1);

    const [request] = recorded.first() as [any, any];

    expect(request.header('x-trace')).toBe('abc');
    expect(request.input('title')).toBe('Thing');
    expect(request.body()).toContain('Thing');
    expect(request.data()).toEqual({ title: 'Thing' });
    expect(request.attemptNumber()).toBe(1);
  });

  it('GET query parameters become the recorded data', async () => {
    Http.fake({ 'https://api.test/search*': { results: [] } });

    await Http.get('https://api.test/search', { q: 'laravel' });

    expect(Http.recorded().first()?.[0].input('q')).toBe('laravel');
  });

  it('multipart attachments are recorded as files', async () => {
    Http.fake({ 'https://upload.test/*': 200 });

    await Http.attach('photo', 'binary-content', 'photo.jpg').post('https://upload.test/media', {
      caption: 'holiday',
    });

    const pairs = Http.recorded().all();

    expect(pairs).toHaveLength(1);

    const request = pairs[0][0];

    expect(request.hasFile('photo')).toBe(true);
    expect(request.file('photo')?.filename).toBe('photo.jpg');
    expect(request.input('caption')).toBe('holiday');
    expect(request.isMultipart()).toBe(true);
  });

  it('acceptance: assertNothingSent and assertSentCount track the exchanges', async () => {
    Http.fake();

    Http.assertNothingSent();
    Http.assertSentCount(0);

    await Http.get('https://counter.test/a');
    await Http.get('https://counter.test/b');

    expect(() => Http.assertNothingSent()).toThrow();
    Http.assertSentCount(2);
    Http.assertSentCount(1, 'https://counter.test/a');
    expect(() => Http.assertSentCount(1)).toThrow(/found \[2\]/);
  });

  it('acceptance: assertSentInOrder checks the exact sequence', async () => {
    Http.fake({ 'https://flow.test/*': 200 });

    await Http.get('https://flow.test/one');
    await Http.post('https://flow.test/two', {});
    await Http.delete('https://flow.test/three');

    Http.assertSentInOrder([
      'https://flow.test/one',
      (request) => request.method === 'POST' && request.url.endsWith('/two'),
      (request) => request.method === 'DELETE',
    ]);

    expect(() =>
      Http.assertSentInOrder([
        'https://flow.test/two',
        'https://flow.test/one',
        (request) => request.method === 'DELETE',
      ])
    ).toThrow(/#1/);
  });

  it('recordings restart with each fake() call', async () => {
    Http.fake();
    await Http.get('https://fresh.test/1');
    Http.assertSentCount(1);

    Http.fake();
    Http.assertNothingSent();
  });
});

describe('stray requests', () => {
  it('acceptance: preventStrayRequests() fails on an unmatched request', async () => {
    Http.fake({ 'https://allowed.test/*': 200 });
    Http.preventStrayRequests();

    const matched = await Http.get('https://allowed.test/ok');

    expect(matched.status()).toBe(200);

    await expect(Http.get('https://surprise.test/')).rejects.toThrow(
      'Call to unexpected and unmocked HTTP method [GET] with the URI [https://surprise.test/].'
    );

    expect(Http.preventingStrayRequests()).toBe(true);
  });

  it('allowStrayRequests(patterns) opens holes in the guard', async () => {
    const passedThrough: string[] = [];

    Http.setTransport({
      async send(request) {
        passedThrough.push(request.url);

        return { status: 418, headers: {}, body: new Uint8Array() };
      },
    });

    Http.fake({ 'https://faked.test/*': 200 });
    Http.preventStrayRequests();
    Http.allowStrayRequests(['https://real.test/*']);

    expect((await Http.get('https://real.test/ping')).status()).toBe(418);
    expect((await Http.get('https://faked.test/ping')).status()).toBe(200);
    expect(passedThrough).toEqual(['https://real.test/ping']);

    await expect(Http.get('https://blocked.test/')).rejects.toThrow(/unexpected and unmocked/);

    Http.stopFaking();
    Http.setTransport(null);

    expect(() => Http.allowStrayRequests()).not.toThrow();
  });

  it('stub patterns follow Laravel matching rules', async () => {
    Http.fake({
      'https://patterns.test/users': { exact: true },
      'https://patterns.test/items/*': { wildcard: true },
      '*.suffix.test/*': { suffix: true },
    });
    Http.preventStrayRequests();

    expect((await Http.get('https://patterns.test/users')).json('exact')).toBe(true);
    expect((await Http.get('https://patterns.test/items/42?x=1')).json('wildcard')).toBe(true);
    expect((await Http.get('https://deep.suffix.test/anything')).json('suffix')).toBe(true);

    // 'users' is a literal pattern: sub-paths are not covered.
    await expect(Http.get('https://patterns.test/users/123')).rejects.toThrow(/unexpected and unmocked/);
  });
});

describe('the fluent surface through fakes', () => {
  it('beforeSending callbacks observe (and can replace) the outgoing request', async () => {
    const seen: string[] = [];

    Http.fake({ 'https://hooks.test/*': 200 });

    await Http.beforeSending((request) => {
      seen.push(`${request.method} ${request.url}`);
    })
      .beforeSending((request) => new Request(request.url, request.method, { ...request.headers(), 'x-added': 'yes' }))
      .get('https://hooks.test/thing');

    expect(seen).toEqual(['GET https://hooks.test/thing']);
    expect(Http.recorded().first()?.[0].header('x-added')).toBe('yes');
  });

  it('baseUrl joins relative paths and with() adds shared query parameters', async () => {
    Http.fake({
      '*': (request) => ({ url: request.url }),
    });

    const response = await Http.baseUrl('https://typed.test').with({ v: '2' }).get('/api');

    expect(response.json('url')).toBe('https://typed.test/api?v=2');
  });

  it('each entry point gets a fresh pending request (config does not bleed)', async () => {
    Http.fake({ '*': 200 });

    await Http.withToken('first').get('https://bleed.test/a');
    await Http.get('https://bleed.test/b');

    expect(Http.recorded().all()[0][0].header('authorization')).toBe('Bearer first');
    expect(Http.recorded().all()[1][0].header('authorization')).toBeNull();
  });

  it('sink works against stubbed responses too', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orchestr-http-stub-'));
    const target = join(dir, 'stubbed.txt');

    try {
      Http.fake({ 'https://sink.test/*': 'stubbed payload' });

      await Http.sink(target).get('https://sink.test/file');

      expect(readFileSync(target, 'utf8')).toBe('stubbed payload');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('response building for stubs', () => {
  it('Http.response() accepts objects, strings, and explicit headers', () => {
    const json = Http.response({ a: 1 }, 201, { 'X-One': 'yes' });

    expect(json).toBeInstanceOf(Response);
    expect(json.status()).toBe(201);
    expect(json.json('a')).toBe(1);
    expect(json.header('x-one')).toBe('yes');
    expect(json.header('content-type')).toBe('application/json');

    expect(Http.response('hi').body()).toBe('hi');
    expect(Http.response().status()).toBe(200);
  });

  it('failedRequest() builds a ready RequestException', () => {
    Http.fake({
      'https://boom.test/*': () => {
        throw Http.failedRequest({ error: 'nope' }, 422);
      },
    });

    return expect(Http.get('https://boom.test/')).rejects.toBeInstanceOf(Error);
  });
});
