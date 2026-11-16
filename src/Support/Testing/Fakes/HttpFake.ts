/**
 * HttpFake
 *
 * Test double for outbound HTTP. `Http.fake()` intercepts the global
 * `fetch`, records every request the application makes and answers it from
 * Laravel-style stubs instead of touching the network:
 *
 * - an object stubs a JSON `200` response;
 * - a string stubs a `200` text response;
 * - a number stubs that status with an empty body;
 * - a `Response` is returned verbatim;
 * - a closure receives the outgoing request and returns any of the above,
 *   and is also accepted as the catch-all `Http.fake(closure)` form;
 * - `{ status, body, headers }` customises the canned response.
 *
 * Stub keys match the request URL literally or with `*` wildcards; the
 * last-registered match wins, mirroring `Http::fake([...])`'s preference
 * for later patterns.
 *
 * @example
 * ```typescript
 * const http = Http.fake({
 *   'https://api.example.com/*': { error: true },
 *   'https://hooks.example.com/*': (request) => ({ ok: true, url: request.url }),
 * });
 *
 * await fetch('https://api.example.com/users');
 *
 * http.assertSent('https://api.example.com/users');
 * http.assertNotSent('https://hooks.example.com/ping');
 * http.restore();
 * ```
 */

/**
 * A recorded outgoing request
 */
export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/**
 * The shape the `fetch(input, init)` arguments take after normalisation
 */
export interface HttpRequestOptions {
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/**
 * What a stub may resolve to
 */
export type StubResponse =
  | string
  | number
  | boolean
  | Record<string, any>
  | ResponseInit
  | Response
  | ((request: RecordedRequest) => StubResponse | Promise<StubResponse>);

type StubValue = StubResponse | ((request: RecordedRequest) => StubResponse | Promise<StubResponse>);

export class HttpFake {
  /**
   * Every request seen while faking, in arrival order
   */
  public readonly requests: RecordedRequest[] = [];

  /**
   * Pattern stubs, in registration order
   */
  protected stubs: Array<{ pattern: string | null; stub: StubValue }> = [];

  /**
   * The fetch this fake replaced, restored by stopFaking()
   */
  protected previousFetch?: typeof globalThis.fetch;

  protected faking: boolean = false;

  /**
   * Start intercepting fetch with the given stubs
   * Laravel: Http::fake()
   */
  fake(stubs: Record<string, StubValue> | StubValue = {}): this {
    if (!this.faking) {
      this.previousFetch = globalThis.fetch;

      const interceptor = ((input: any, init?: any) => this.handle(input, init)) as typeof globalThis.fetch;

      globalThis.fetch = interceptor;
      this.faking = true;
    }

    if (typeof stubs === 'function' || !isPlainRecord(stubs)) {
      this.stub(stubs as StubValue);
      return this;
    }

    for (const [pattern, stub] of Object.entries(stubs)) {
      this.stub(stub, pattern);
    }

    return this;
  }

  /**
   * Register a stub, optionally for a URL pattern (catch-all without one)
   * Laravel: Http::stub / the entries of Http::fake([...])
   */
  stub(stub: StubValue, pattern?: string): this {
    this.stubs.push({ pattern: pattern ?? null, stub });

    return this;
  }

  /**
   * Stop intercepting fetch and hand the original back
   * Laravel: Http::fake()'s inverse
   */
  restore(): void {
    if (!this.faking) {
      return;
    }

    if (this.previousFetch) {
      globalThis.fetch = this.previousFetch;
    } else {
      delete (globalThis as any).fetch;
    }

    this.previousFetch = undefined;
    this.faking = false;
  }

  /**
   * Whether this fake currently owns globalThis.fetch
   */
  isFaking(): boolean {
    return this.faking;
  }

  /**
   * The recorded requests matching a URL string (with optional `*`
   * wildcards) or predicate
   */
  recorded(matcher?: string | ((request: RecordedRequest) => boolean)): RecordedRequest[] {
    if (matcher === undefined) {
      return [...this.requests];
    }

    return this.requests.filter((request) => this.matchesMatcher(request, matcher));
  }

  /**
   * The most recent recorded request matching the matcher
   */
  lastRequest(matcher?: string | ((request: RecordedRequest) => boolean)): RecordedRequest | null {
    const matching = this.recorded(matcher);

    return matching.length > 0 ? matching[matching.length - 1] : null;
  }

  // ==================== Assertions ====================

  /**
   * Assert a recorded request matches the URL pattern/predicate, and -
   * when a callback is given - its details
   * Laravel: Http::assertSent()
   */
  assertSent(
    matcher?: string | ((request: RecordedRequest) => boolean),
    callback?: (request: RecordedRequest) => boolean
  ): void {
    const matching = this.recorded(matcher ?? (() => true));

    const satisfied =
      matching.length > 0 && (callback === undefined || matching.some((request) => callback(request) !== false));

    if (!satisfied) {
      throw new Error(
        `An outbound request was not sent matching [${describeMatcher(matcher)}].\n` +
          `Recorded: ${this.describeRecorded()}`
      );
    }
  }

  /**
   * Assert no recorded request matches
   * Laravel: Http::assertNotSent()
   */
  assertNotSent(
    matcher?: string | ((request: RecordedRequest) => boolean),
    callback?: (request: RecordedRequest) => boolean
  ): void {
    const matching = this.recorded(matcher ?? (() => true));

    if (matching.length > 0 && (callback === undefined || matching.some((request) => callback(request) !== false))) {
      throw new Error(`An outbound request was sent matching [${describeMatcher(matcher)}].`);
    }
  }

  /**
   * Assert exactly this many requests matched
   * Laravel: Http::assertSent(fn () => ...) counts / sequence lengths
   */
  assertSentCount(count: number, matcher?: string | ((request: RecordedRequest) => boolean)): void {
    const actual = this.recorded(matcher ?? (() => true)).length;

    if (actual !== count) {
      throw new Error(
        `Expected [${count}] outbound request(s) matching [${describeMatcher(matcher)}], found [${actual}].`
      );
    }
  }

  /**
   * Assert nothing was requested while faking
   * Laravel: Http::assertNothingSent()
   */
  assertNothingSent(): void {
    this.assertSentCount(0);
  }

  // ==================== Internals ====================

  /**
   * Record an outgoing call and answer it from the stub table
   */
  protected async handle(input: any, init: any): Promise<Response> {
    const request = this.normalize(input, init);

    this.requests.push(request);

    const match = [...this.stubs]
      .reverse()
      .find(({ pattern }) => pattern === null || patternMatches(pattern, request.url));

    if (!match) {
      // Unstubbed requests reach the network, like Http::fake()'s
      // unmatched URLs; with no real fetch to fall back on, fail loudly.
      if (this.previousFetch) {
        return this.previousFetch(input, init);
      }

      throw new Error(`No stub for [${request.method} ${request.url}].\nRecorded: ${this.describeRecorded()}`);
    }

    let stub = match.stub;

    if (typeof stub === 'function') {
      stub = await (stub as (request: RecordedRequest) => StubResponse | Promise<StubResponse>)(request);
    }

    return toResponse(stub);
  }

  /**
   * Flatten fetch's (input, init) arguments into a recorded request
   */
  protected normalize(input: any, init: any): RecordedRequest {
    const isRequestLike = typeof input === 'object' && input !== null && !(input instanceof URL);

    const url: string =
      typeof input === 'string'
        ? input
        : isRequestLike || input instanceof URL
          ? String(input.url ?? input)
          : String(input);

    const rawHeaders: Record<string, any> = {};

    const collectHeaders = (source: any): void => {
      if (!source) {
        return;
      }

      if (typeof source.forEach === 'function') {
        source.forEach((value: string, key: string) => {
          rawHeaders[key] = value;
        });
        return;
      }

      Object.assign(rawHeaders, source);
    };

    collectHeaders(init?.headers);
    collectHeaders(isRequestLike ? input.headers : undefined);

    const headers: Record<string, string> = {};

    for (const [name, value] of Object.entries(rawHeaders)) {
      headers[name.toLowerCase()] = String(value);
    }

    const method: string = String(init?.method ?? (isRequestLike ? input.method : undefined) ?? 'GET').toUpperCase();

    let body: any = init?.body ?? (isRequestLike ? input.body : undefined);

    if (body !== null && body !== undefined && typeof body !== 'string') {
      body = String(body);
    }

    return { url, method, headers, body: body ?? null };
  }

  protected matchesMatcher(
    request: RecordedRequest,
    matcher: string | ((request: RecordedRequest) => boolean)
  ): boolean {
    return typeof matcher === 'string' ? patternMatches(matcher, request.url) : matcher(request);
  }

  protected describeRecorded(): string {
    if (this.requests.length === 0) {
      return 'no outbound requests';
    }

    return this.requests.map((request) => `${request.method} ${request.url}`).join(', ');
  }
}

/**
 * Create and install a fake; the returned instance restores the real fetch
 * when `restore()` is called
 */
export function fakeHttp(stubs: Record<string, StubValue> | StubValue = {}): HttpFake {
  const fake = new HttpFake();

  return fake.fake(stubs);
}

/**
 * Match a URL against a stub pattern: literal equality, or `*` wildcards
 */
function patternMatches(pattern: string, url: string): boolean {
  if (pattern === url) {
    return true;
  }

  if (!pattern.includes('*')) {
    return false;
  }

  const regex = new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`);

  return regex.test(url);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Turn a stub value into the Response the application will see
 */
function toResponse(stub: StubResponse): Response {
  if (stub instanceof Response) {
    return stub;
  }

  if (typeof stub === 'number') {
    return new Response('', { status: stub });
  }

  if (typeof stub === 'boolean' || stub === null) {
    return new Response('', { status: stub === true ? 200 : 204 });
  }

  if (typeof stub === 'string') {
    return new Response(stub, { status: 200 });
  }

  const record = stub as Record<string, any>;

  const looksLikeEnvelope =
    record.error !== undefined ||
    typeof record.status === 'number' ||
    record.body !== undefined ||
    record.headers !== undefined;

  if (looksLikeEnvelope) {
    const status = record.error === true ? 500 : Number(record.status ?? 200);
    const headers: Record<string, string> = { ...(record.headers ?? {}) };
    const body = record.body;

    if (body !== undefined && body !== null && typeof body === 'object') {
      headers['content-type'] ??= 'application/json';

      return new Response(JSON.stringify(body), { status, headers });
    }

    return new Response(body === undefined || body === null ? '' : String(body), { status, headers });
  }

  return new Response(JSON.stringify(stub), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Whether a stub argument is a pattern-keyed record rather than a single
 * canned response
 */
function isPlainRecord(value: any): value is Record<string, StubValue> {
  return typeof value === 'object' && value !== null && !(value instanceof Response);
}

function describeMatcher(matcher?: string | ((request: RecordedRequest) => boolean)): string {
  if (matcher === undefined) {
    return 'any request';
  }

  return typeof matcher === 'string' ? matcher : 'the provided callback';
}
