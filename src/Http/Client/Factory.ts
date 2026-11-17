/**
 * Factory - the entry point of the HTTP client.
 *
 * Mirrors Illuminate\Http\Client\Factory: it owns the outbound
 * transport (swappable behind the Transport contract), creates a fresh
 * PendingRequest per entry point, and - once `fake()` is called -
 * records request/response pairs, answers them from stubs, and exposes
 * the Laravel assertion suite (assertSent, assertNotSent,
 * assertNothingSent, assertSentCount, assertSentInOrder).
 *
 * @example
 * ```typescript
 * Http.fake({ 'https://api.example.com/*': { data: { name: 'Ada' } } });
 *
 * const response = await Http.withToken('secret').get('https://api.example.com/me');
 *
 * response.json('data.name'); // 'Ada'
 * Http.assertSent('https://api.example.com/me');
 * ```
 */

import type { Transport } from '@/Http/Client/Contracts/Transport';
import { Collection } from '@/Support/Collection';
import type {
  RetryDelay,
  RetryWhenCallback,
  StubCallback,
  StubValue,
  ThrowCallback,
  ThrowIfCallback,
} from './PendingRequest';
import type { BeforeSendingCallback } from './PendingRequest';
import { ConnectionException } from './ConnectionException';
import { PendingRequest } from './PendingRequest';
import { Request } from './Request';
import { RequestException } from './RequestException';
import { Response } from './Response';
import { Sequence } from './Sequence';
import { FetchTransport } from './Transports/FetchTransport';

/**
 * A recorded outbound exchange: the request plus the response it drew
 * (null when the connection failed).
 */
export type RequestResponsePair = [Request, Response | null];

/**
 * The stub table shape accepted by fake(): URL pattern => stub value.
 */
export type FakeStubMap = Record<string, StubValue>;

/**
 * Callback matchers used across the assertion suite.
 */
export type RecordedMatcher = string | ((request: Request, response: Response | null) => unknown);

export class Factory {
  /**
   * The transport every request goes through (OCP seam).
   */
  protected transport: Transport = new FetchTransport();

  /**
   * Registered stub callbacks, consulted in order; the first one that
   * answers wins.
   */
  protected stubCallbacks: StubCallback[] = [];

  /**
   * Whether exchanges are being recorded for assertions.
   */
  protected recording: boolean = false;

  /**
   * The recorded pairs, in arrival order.
   */
  protected records: RequestResponsePair[] = [];

  /**
   * Sequences handed out by sequence()/fakeSequence(), for
   * assertSequencesAreEmpty().
   */
  protected responseSequences: Sequence[] = [];

  /**
   * Whether unfaked requests should throw instead of reaching the
   * network.
   */
  protected preventStray: boolean = false;

  /**
   * URL patterns allowed past the stray guard.
   */
  protected allowedStrayUrls: string[] = [];

  /**
   * Options applied to every pending request created here.
   * Laravel: Factory::$globalOptions
   */
  protected globalOptionsValue: Record<string, any> = {};

  // ==================== Transport ====================

  /**
   * The transport currently in use.
   */
  getTransport(): Transport {
    return this.transport;
  }

  /**
   * Swap the outbound transport; null restores the default fetch
   * transport. Custom adapters implement the Transport contract.
   */
  setTransport(transport: Transport | null): this {
    this.transport = transport ?? new FetchTransport();

    return this;
  }

  /**
   * Options merged into every pending request created from this
   * factory.
   * Laravel: Factory::globalOptions()
   */
  globalOptions(options: Record<string, any>): this {
    this.globalOptionsValue = options;

    return this;
  }

  // ==================== Pending requests ====================

  /**
   * A fresh PendingRequest carrying the factory's stubs, stray guard
   * and global options.
   * Laravel: Factory::createPendingRequest()
   */
  createPendingRequest(): PendingRequest {
    const pending = new PendingRequest(this);

    pending.withOptions(this.globalOptionsValue);
    pending.stub(this.stubCallbacks);
    pending.preventStrayRequests(this.preventStray);
    pending.allowStrayRequests(this.allowedStrayUrls);

    return pending;
  }

  // ==================== Fluent forwards ====================

  /**
   * Laravel: Http::baseUrl()
   */
  baseUrl(url: string): PendingRequest {
    return this.createPendingRequest().baseUrl(url);
  }

  /**
   * Laravel: Http::with()
   */
  with(query: Record<string, any>): PendingRequest {
    return this.createPendingRequest().with(query);
  }

  /**
   * Laravel: Http::withHeaders()
   */
  withHeaders(headers: Record<string, any>): PendingRequest {
    return this.createPendingRequest().withHeaders(headers);
  }

  /**
   * Laravel: Http::withHeader()
   */
  withHeader(name: string, value: any): PendingRequest {
    return this.createPendingRequest().withHeader(name, value);
  }

  /**
   * Laravel: Http::withBasicAuth()
   */
  withBasicAuth(username: string, password: string): PendingRequest {
    return this.createPendingRequest().withBasicAuth(username, password);
  }

  /**
   * Laravel: Http::withDigestAuth()
   */
  withDigestAuth(username: string, password: string): PendingRequest {
    return this.createPendingRequest().withDigestAuth(username, password);
  }

  /**
   * Laravel: Http::withToken()
   */
  withToken(token: string, type: string = 'Bearer'): PendingRequest {
    return this.createPendingRequest().withToken(token, type);
  }

  /**
   * Laravel: Http::withCookies()
   */
  withCookies(cookies: Record<string, string>, domain?: string): PendingRequest {
    return this.createPendingRequest().withCookies(cookies, domain);
  }

  /**
   * Laravel: Http::withOptions()
   */
  withOptions(options: Record<string, any>): PendingRequest {
    return this.createPendingRequest().withOptions(options);
  }

  /**
   * Laravel: Http::withBody()
   */
  withBody(content: string | Uint8Array, contentType?: string): PendingRequest {
    return this.createPendingRequest().withBody(content, contentType);
  }

  /**
   * Laravel: Http::timeout()
   */
  timeout(seconds: number): PendingRequest {
    return this.createPendingRequest().timeout(seconds);
  }

  /**
   * Laravel: Http::connectTimeout()
   */
  connectTimeout(seconds: number): PendingRequest {
    return this.createPendingRequest().connectTimeout(seconds);
  }

  /**
   * Laravel: Http::retry()
   */
  retry(
    times: number | number[],
    sleepMilliseconds?: RetryDelay,
    when?: RetryWhenCallback,
    throwOnExhaustion?: boolean
  ): PendingRequest {
    return this.createPendingRequest().retry(times, sleepMilliseconds, when, throwOnExhaustion);
  }

  /**
   * Laravel: Http::retryWhen()
   */
  retryWhen(callback: RetryWhenCallback): PendingRequest {
    return this.createPendingRequest().retryWhen(callback);
  }

  /**
   * Laravel: Http::throw()
   */
  throw(callback?: ThrowCallback): PendingRequest {
    return this.createPendingRequest().throw(callback);
  }

  /**
   * Laravel: Http::throwIf()
   */
  throwIf(condition: boolean | ThrowIfCallback, callback?: ThrowCallback): PendingRequest {
    return this.createPendingRequest().throwIf(condition, callback);
  }

  /**
   * Laravel: Http::throwUnless()
   */
  throwUnless(condition: boolean | ThrowIfCallback, callback?: ThrowCallback): PendingRequest {
    return this.createPendingRequest().throwUnless(condition, callback);
  }

  /**
   * Laravel: Http::asJson()
   */
  asJson(): PendingRequest {
    return this.createPendingRequest().asJson();
  }

  /**
   * Laravel: Http::asForm()
   */
  asForm(): PendingRequest {
    return this.createPendingRequest().asForm();
  }

  /**
   * Laravel: Http::asMultipart()
   */
  asMultipart(): PendingRequest {
    return this.createPendingRequest().asMultipart();
  }

  /**
   * Laravel: Http::attach()
   */
  attach(
    name: string | Array<{ name: string; contents?: any; filename?: string; headers?: Record<string, string> }>,
    contents?: any,
    filename?: string,
    headers?: Record<string, string>
  ): PendingRequest {
    return this.createPendingRequest().attach(name, contents, filename, headers);
  }

  /**
   * Laravel: Http::sink()
   */
  sink(to: string): PendingRequest {
    return this.createPendingRequest().sink(to);
  }

  /**
   * Laravel: Http::accept()
   */
  accept(contentType: string): PendingRequest {
    return this.createPendingRequest().accept(contentType);
  }

  /**
   * Laravel: Http::acceptJson()
   */
  acceptJson(): PendingRequest {
    return this.createPendingRequest().acceptJson();
  }

  /**
   * Laravel: Http::beforeSending()
   */
  beforeSending(callback: BeforeSendingCallback): PendingRequest {
    return this.createPendingRequest().beforeSending(callback);
  }

  // ==================== Verbs ====================

  /**
   * Laravel: Http::get()
   */
  get(url: string, query?: string | Record<string, any>): Promise<Response> {
    return this.createPendingRequest().get(url, query);
  }

  /**
   * Laravel: Http::post()
   */
  post(url: string, data?: any): Promise<Response> {
    return this.createPendingRequest().post(url, data);
  }

  /**
   * Laravel: Http::put()
   */
  put(url: string, data?: any): Promise<Response> {
    return this.createPendingRequest().put(url, data);
  }

  /**
   * Laravel: Http::patch()
   */
  patch(url: string, data?: any): Promise<Response> {
    return this.createPendingRequest().patch(url, data);
  }

  /**
   * Laravel: Http::delete()
   */
  delete(url: string, data?: any): Promise<Response> {
    return this.createPendingRequest().delete(url, data);
  }

  /**
   * Laravel: Http::head()
   */
  head(url: string, query?: string | Record<string, any>): Promise<Response> {
    return this.createPendingRequest().head(url, query);
  }

  /**
   * Laravel: Http::options()
   */
  options(url: string, query?: string | Record<string, any>): Promise<Response> {
    return this.createPendingRequest().options(url, query);
  }

  /**
   * Send an arbitrary verb through a fresh pending request.
   * Laravel: Http::request()
   */
  send(
    method: string,
    url: string,
    options: { query?: string | Record<string, any>; data?: any } = {}
  ): Promise<Response> {
    return this.createPendingRequest().send(method, url, options);
  }

  // ==================== Faking ====================

  /**
   * Register a catch-all stub callback.
   * Laravel: PendingRequest::stub() (exposed at the factory)
   */
  stub(callback: StubCallback): this {
    this.stubCallbacks.push(callback);

    return this;
  }

  /**
   * Register stubs for URL patterns - or a single catch-all stub.
   * Starts recording and clears previous records, like
   * `Http::fake([...])`.
   * Laravel: Factory::fake()
   */
  fake(stubs: FakeStubMap | StubValue | null = null): this {
    this.record();
    this.records = [];

    if (stubs === null || stubs === undefined) {
      this.stub(() => Response.make());

      return this;
    }

    if (isStubMap(stubs)) {
      for (const [pattern, stub] of Object.entries(stubs)) {
        this.stubUrl(pattern, stub);
      }

      return this;
    }

    this.stub(() => stubs as StubValue);

    return this;
  }

  /**
   * Stub a single URL pattern. Patterns match Laravel-style: a missing
   * leading `*` is added, and `*` wildcards are honoured.
   * Laravel: Factory::stubUrl()
   */
  stubUrl(pattern: string, stub: StubValue): this {
    return this.stub((request) => (globMatches(leadingWildcard(pattern), request.url) ? stub : undefined));
  }

  /**
   * Fake the given URL pattern with a sequence of responses.
   * Laravel: Factory::fakeSequence()
   */
  fakeSequence(url: string = '*'): Sequence {
    const sequence = this.sequence();

    this.stubUrl(url, sequence);

    return sequence;
  }

  /**
   * Build a tracked response sequence for stubbing.
   * Laravel: Factory::sequence()
   */
  sequence(responses: StubValue[] = []): Sequence {
    const sequence = new Sequence(responses);

    this.responseSequences.push(sequence);

    return sequence;
  }

  /**
   * Build a Response for use in stubs.
   * Laravel: Factory::response()
   */
  response(body?: any, status: number = 200, headers: Record<string, string | string[]> = {}): Response {
    return Response.make(body, status, headers);
  }

  /**
   * Build a RequestException for use in stubs (throw it from a stub
   * callback to simulate a failed request).
   * Laravel: Factory::failedRequest()
   */
  failedRequest(body?: any, status: number = 500, headers: Record<string, string | string[]> = {}): RequestException {
    return new RequestException(Response.make(body, status, headers));
  }

  /**
   * A stub callback that fails with a ConnectionException.
   * Laravel: Factory::failedConnection()
   */
  failedConnection(message?: string): StubCallback {
    return (request: Request) => {
      throw new ConnectionException(message ?? `Could not resolve host for [${request.url}].`);
    };
  }

  /**
   * Fail any request that no stub answers, instead of letting it reach
   * the network.
   * Laravel: Factory::preventStrayRequests()
   */
  preventStrayRequests(prevent: boolean = true): this {
    this.preventStray = prevent;

    return this;
  }

  /**
   * Whether stray requests are blocked.
   * Laravel: Factory::preventingStrayRequests()
   */
  preventingStrayRequests(): boolean {
    return this.preventStray;
  }

  /**
   * Lift the stray guard entirely, or allow specific URL patterns
   * through it.
   * Laravel: Factory::allowStrayRequests()
   */
  allowStrayRequests(only?: string[]): this {
    if (only === undefined) {
      this.preventStray = false;
      this.allowedStrayUrls = [];
    } else {
      this.allowedStrayUrls = [...only];
    }

    return this;
  }

  /**
   * Drop all stubs (and the stray guard); recordings stay available
   * for assertions until the next fake().
   */
  stopFaking(): this {
    this.stubCallbacks = [];
    this.recording = false;
    this.responseSequences = [];
    this.preventStray = false;
    this.allowedStrayUrls = [];

    return this;
  }

  // ==================== Recording & assertions ====================

  /**
   * Start recording request/response pairs.
   * Laravel: Factory::record()
   */
  record(): this {
    this.recording = true;

    return this;
  }

  /**
   * Stop recording.
   * Laravel: Factory::stopRecording()
   */
  stopRecording(): this {
    this.recording = false;

    return this;
  }

  /**
   * Record one exchange, when recording is on.
   * Laravel: Factory::recordRequestResponsePair()
   */
  recordRequestResponsePair(request: Request, response: Response | null): void {
    if (this.recording) {
      this.records.push([request, response]);
    }
  }

  /**
   * Recorded pairs matching a URL pattern or callback; all of them
   * without a matcher.
   * Laravel: Factory::recorded()
   */
  recorded(matcher?: RecordedMatcher): Collection<RequestResponsePair> {
    const matching = this.matched(matcher);

    return new Collection([...matching] as RequestResponsePair[]);
  }

  /**
   * Forget all recorded exchanges.
   */
  flushRecorded(): this {
    this.records = [];

    return this;
  }

  /**
   * The most recently recorded pair, or null.
   */
  lastRecorded(): RequestResponsePair | null {
    return this.records.length > 0 ? this.records[this.records.length - 1] : null;
  }

  /**
   * Assert a recorded request matches the pattern/callback.
   * Laravel: Factory::assertSent()
   */
  assertSent(matcher: RecordedMatcher): void {
    if (this.matched(matcher).length === 0) {
      throw new Error(`An expected request was not recorded.\nRecorded: ${describeRecorded(this.records)}`);
    }
  }

  /**
   * Assert no recorded request matches.
   * Laravel: Factory::assertNotSent()
   */
  assertNotSent(matcher: RecordedMatcher): void {
    const matching = this.matched(matcher);

    if (matching.length > 0) {
      throw new Error(`Unexpected request was recorded: ${describeRecorded(matching)}.`);
    }
  }

  /**
   * Assert nothing was recorded.
   * Laravel: Factory::assertNothingSent()
   */
  assertNothingSent(): void {
    if (this.records.length > 0) {
      throw new Error(`Requests were recorded: ${describeRecorded(this.records)}.`);
    }
  }

  /**
   * Assert exactly `count` exchanges were recorded (optionally only
   * those matching a pattern/callback).
   * Laravel: Factory::assertSentCount()
   */
  assertSentCount(count: number, matcher?: RecordedMatcher): void {
    const actual = matcher === undefined ? this.records.length : this.matched(matcher).length;

    if (actual !== count) {
      throw new Error(
        `Expected [${count}] recorded request(s), found [${actual}].\nRecorded: ${describeRecorded(this.records)}`
      );
    }
  }

  /**
   * Assert the recorded requests match these patterns/callbacks, in
   * this exact order (and count).
   * Laravel: Factory::assertSentInOrder()
   */
  assertSentInOrder(matchers: RecordedMatcher[]): void {
    this.assertSentCount(matchers.length);

    matchers.forEach((matcher, index) => {
      const [request, response] = this.records[index];

      if (!matchesPair(matcher, request, response)) {
        throw new Error(
          `An expected request (#${index + 1}) was not recorded.\nRecorded: ${describeRecorded(this.records)}`
        );
      }
    });
  }

  /**
   * Assert every created sequence has run out of responses.
   * Laravel: Factory::assertSequencesAreEmpty()
   */
  assertSequencesAreEmpty(): void {
    for (const sequence of this.responseSequences) {
      if (!sequence.isEmpty()) {
        throw new Error('Not all response sequences are empty.');
      }
    }
  }

  // ==================== Internals ====================

  protected matched(matcher?: RecordedMatcher): RequestResponsePair[] {
    if (matcher === undefined) {
      return [...this.records];
    }

    return this.records.filter((pair) => matchesPair(matcher, pair[0], pair[1]));
  }
}

/**
 * Whether a fake() argument is a pattern-keyed stub map rather than a
 * single stub value.
 */
function isStubMap(value: FakeStubMap | StubValue): value is FakeStubMap {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Response) &&
    !(value instanceof Sequence) &&
    !(value instanceof Error)
  );
}

function matchesPair(matcher: RecordedMatcher, request: Request, response: Response | null): boolean {
  if (typeof matcher === 'function') {
    return !!matcher(request, response);
  }

  return globMatches(leadingWildcard(matcher), request.url);
}

/**
 * Laravel matches stub/assertion patterns after prefixing them with a
 * wildcard (Str::is(Str::start($url, '*'), ...)).
 */
function leadingWildcard(pattern: string): string {
  return pattern.startsWith('*') ? pattern : `*${pattern}`;
}

function globMatches(pattern: string, value: string): boolean {
  if (!pattern.includes('*')) {
    return pattern === value;
  }

  return new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function describeRecorded(pairs: RequestResponsePair[]): string {
  if (pairs.length === 0) {
    return 'no requests';
  }

  return pairs.map(([request]) => `${request.method} ${request.url}`).join(', ');
}

/**
 * The process-wide default factory, used by the `Http` facade and the
 * `http()` helper when no application binding exists.
 */
let defaultInstance: Factory | null = null;

export function defaultFactory(): Factory {
  if (!defaultInstance) {
    defaultInstance = new Factory();
  }

  return defaultInstance;
}
