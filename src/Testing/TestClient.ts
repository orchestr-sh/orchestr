/**
 * TestClient
 *
 * Builds raw requests and drives them through the application's own HTTP
 * Kernel - the same pipeline a served request travels (global middleware,
 * the router, the exception handler) - while capturing status, headers,
 * cookies and body. There is deliberately no second server here: request
 * construction and result capture are the only things this class adds.
 *
 * Mirrors the request-building half of
 * Illuminate\Foundation\Testing\Concerns\MakesHttpRequests.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import type { Application } from '@/Foundation/Application';
import type { Kernel } from '@/Foundation/Http/Kernel';
import type { Middleware } from '@/Routing/Pipeline';
import type { Request } from '@/Routing/Request';
import type { SessionManager } from '@/Session/SessionManager';
import { TestResponse } from '@/Testing/TestResponse';

/**
 * Per-request options the verb methods pass down
 */
export interface CallOptions {
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  /** Send as `application/json` */
  json?: boolean;
  /** urlencoded (default for post/put/patch) or a raw string body */
  body?: Record<string, any> | string;
}

/**
 * The exception-handling expectations a TestCase arms the client with;
 * every request consults it so `expectException` semantics work without a
 * runner-specific spy
 */
export interface ExceptionExpectation {
  /** True when an expectation still needs to be satisfied */
  isPending(): boolean;

  /** Verify a thrown error; true consumes the expectation */
  verifyThrown(error: unknown): boolean;

  /** Called when a request completes without throwing */
  requestCompleted(): void;
}

export class TestClient {
  /**
   * Headers merged into every request until reset
   */
  protected defaultHeaders: Record<string, string> = {};

  /**
   * Cookies merged into every request until reset
   */
  protected defaultCookies: Record<string, string> = {};

  /**
   * Session data seeded ahead of the next request
   */
  protected sessionData: Record<string, any> | null = null;

  /**
   * Whether redirects are followed transparently
   */
  protected followRedirectsEnabled: boolean = false;

  /**
   * Cookie jar carried between requests, like a browser's
   */
  protected jar: Map<string, string> = new Map();

  /**
   * The most recent application request the pipeline saw
   */
  public lastRequest?: Request;

  /**
   * Exception expectations installed by the TestCase's
   * InteractsWithExceptionHandling concern
   */
  public exceptionExpectation?: ExceptionExpectation;

  /**
   * How many redirects a following call traverses at most
   */
  protected static readonly maxRedirects = 5;

  constructor(
    public readonly app: Application,
    public readonly kernel: Kernel
  ) {
    // Global middleware runs first in the kernel pipeline, so this tap
    // sees every request the application handles - the seam for reading
    // back the session the route worked with.
    const tap: Middleware = (req, _res, next) => {
      this.lastRequest = req;
      return next();
    };

    kernel.use(tap);
  }

  // ==================== Request customization ====================

  /**
   * Add default headers to subsequent requests
   * Laravel: withHeaders
   */
  withHeaders(headers: Record<string, string>): this {
    Object.assign(this.defaultHeaders, headers);
    return this;
  }

  /**
   * Add a single default header
   * Laravel: withHeader
   */
  withHeader(name: string, value: string): this {
    this.defaultHeaders[name] = value;
    return this;
  }

  /**
   * Send this bearer token on subsequent requests
   * Laravel: withToken
   */
  withToken(token: string): this {
    return this.withHeader('Authorization', `Bearer ${token}`);
  }

  /**
   * Add default cookies to subsequent requests
   * Laravel: withCookies
   */
  withCookies(cookies: Record<string, string>): this {
    Object.assign(this.defaultCookies, cookies);
    return this;
  }

  /**
   * Seed session data for the next request: a real session is started,
   * the values written, and its cookie carried onto the request so the
   * application picks the same store up
   * Laravel: withSession
   */
  withSession(data: Record<string, any>): this {
    this.sessionData = { ...(this.sessionData ?? {}), ...data };
    return this;
  }

  /**
   * Follow redirect responses instead of returning them
   * Laravel: followingRedirects
   */
  followingRedirects(): this {
    this.followRedirectsEnabled = true;
    return this;
  }

  /**
   * Forget default headers, cookies, session seed data and the jar
   */
  reset(): void {
    this.defaultHeaders = {};
    this.defaultCookies = {};
    this.sessionData = null;
    this.followRedirectsEnabled = false;
    this.jar.clear();
  }

  // ==================== Verbs ====================

  get(uri: string, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.call('GET', uri, { headers });
  }

  head(uri: string, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.call('HEAD', uri, { headers });
  }

  options(uri: string, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.call('OPTIONS', uri, { headers });
  }

  post(
    uri: string,
    data: Record<string, any> | string = {},
    headers: Record<string, string> = {}
  ): Promise<TestResponse> {
    return this.call('POST', uri, { headers, body: data });
  }

  put(
    uri: string,
    data: Record<string, any> | string = {},
    headers: Record<string, string> = {}
  ): Promise<TestResponse> {
    return this.call('PUT', uri, { headers, body: data });
  }

  patch(
    uri: string,
    data: Record<string, any> | string = {},
    headers: Record<string, string> = {}
  ): Promise<TestResponse> {
    return this.call('PATCH', uri, { headers, body: data });
  }

  delete(
    uri: string,
    data: Record<string, any> | string = {},
    headers: Record<string, string> = {}
  ): Promise<TestResponse> {
    return this.call('DELETE', uri, { headers, body: data });
  }

  /**
   * JSON-verb shorthands: JSON in, `Accept: application/json`
   * Laravel: postJson / putJson / patchJson / deleteJson / optionsJson
   */
  postJson(uri: string, data: Record<string, any> = {}, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.call('POST', uri, { headers, body: data, json: true });
  }

  putJson(uri: string, data: Record<string, any> = {}, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.call('PUT', uri, { headers, body: data, json: true });
  }

  patchJson(uri: string, data: Record<string, any> = {}, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.call('PATCH', uri, { headers, body: data, json: true });
  }

  deleteJson(uri: string, data: Record<string, any> = {}, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.call('DELETE', uri, { headers, body: data, json: true });
  }

  optionsJson(
    uri: string,
    data: Record<string, any> = {},
    headers: Record<string, string> = {}
  ): Promise<TestResponse> {
    return this.call('OPTIONS', uri, { headers, body: data, json: true });
  }

  /**
   * The generic JSON request
   * Laravel: json($method, $uri, $data, $headers)
   */
  json(
    method: string,
    uri: string,
    data: Record<string, any> = {},
    headers: Record<string, string> = {}
  ): Promise<TestResponse> {
    return this.call(method.toUpperCase(), uri, { headers, body: data, json: true });
  }

  // ==================== Dispatch ====================

  /**
   * Send one request through the kernel and capture the response,
   * following redirects when asked
   * Laravel: MakesHttpRequests::call
   */
  async call(method: string, uri: string, options: CallOptions = {}): Promise<TestResponse> {
    const history: TestResponse[] = [];

    let currentMethod = method.toUpperCase();
    let currentUri = uri;
    let currentOptions = options;

    for (let hop = 0; ; hop++) {
      let response: TestResponse;

      try {
        response = await this.send(currentMethod, currentUri, currentOptions);
      } catch (error) {
        if (this.exceptionExpectation?.verifyThrown(error)) {
          // The application threw exactly what the test armed; there is no
          // rendered response to assert on.
          return new TestResponse({
            status: 0,
            headers: {},
            cookies: [],
            body: '',
            request: this.lastRequest,
          });
        }

        throw error;
      }

      if (this.exceptionExpectation?.isPending()) {
        this.exceptionExpectation.requestCompleted();
      }

      if (!response.isRedirect() || !this.followRedirectsEnabled) {
        return new TestResponse({
          status: response.status,
          headers: response.headers,
          cookies: response.cookies,
          body: response.content,
          request: this.lastRequest,
          history,
        });
      }

      if (hop >= TestClient.maxRedirects) {
        throw new Error(`Too many redirects: followed ${history.length + 1} without reaching a final response.`);
      }

      history.push(response);

      const next = new URL(response.header('Location') as string, 'http://localhost');
      const switchToGet = currentMethod !== 'GET' && currentMethod !== 'HEAD';

      currentUri = next.pathname + next.search;
      currentMethod = switchToGet ? 'GET' : currentMethod;
      currentOptions = switchToGet ? { headers: currentOptions.headers } : currentOptions;
    }
  }

  /**
   * One kernel round trip
   */
  protected async send(method: string, uri: string, options: CallOptions): Promise<TestResponse> {
    const body = this.serializeBody(options);
    const headers = this.mergeHeaders(method, uri, options, body !== undefined);
    const raw = new IncomingMessage(new Socket());
    raw.method = method;
    raw.url = uri;
    raw.headers = {};

    for (const [name, value] of Object.entries(headers)) {
      raw.headers[name.toLowerCase()] = value;
    }

    if (body !== undefined) {
      raw.push(Buffer.from(body));
    }

    raw.push(null);

    const captured = captureResponse();

    await this.kernel.handle(raw, captured.raw);

    this.absorbCookies(captured.cookies);
    this.sessionData = null; // consumed, like Laravel's session seeding

    return new TestResponse({
      status: captured.raw.statusCode,
      headers: captured.headers,
      cookies: captured.cookies,
      body: captured.chunks.join(''),
      request: this.lastRequest,
    });
  }

  // ==================== Plumbing ====================

  /**
   * Build the final header bag: defaults, explicit headers, the content
   * types implied by the body, cookies and the session seed cookie
   */
  protected mergeHeaders(
    _method: string,
    _uri: string,
    options: CallOptions,
    hasBody: boolean
  ): Record<string, string> {
    const merged: Record<string, string> = { ...this.defaultHeaders, ...options.headers };

    if (hasBody && !this.hasHeader(merged, 'content-type')) {
      merged['Content-Type'] = options.json ? 'application/json' : 'application/x-www-form-urlencoded';
    }

    if (options.json && !this.hasHeader(merged, 'accept')) {
      merged['Accept'] = 'application/json';
    }

    const cookies: Record<string, string> = {};

    for (const [name, value] of this.jar) {
      cookies[name] = value;
    }

    Object.assign(cookies, this.defaultCookies, options.cookies ?? {});

    const sessionCookie = this.seedSession();

    if (sessionCookie) {
      cookies[sessionCookie.name] = sessionCookie.value;
    }

    const headerEntries = Object.entries(merged);

    for (const [name] of headerEntries) {
      if (name.toLowerCase() === 'cookie') {
        throw new Error('Set cookies with withCookies()/call options, not through a raw Cookie header.');
      }
    }

    if (Object.keys(cookies).length > 0) {
      merged['Cookie'] = Object.entries(cookies)
        .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
        .join('; ');
    }

    return merged;
  }

  /**
   * Case-insensitive presence check for a header the caller set
   */
  protected hasHeader(headers: Record<string, string>, name: string): boolean {
    const lowered = name.toLowerCase();

    return Object.keys(headers).some((key) => key.toLowerCase() === lowered);
  }

  /**
   * Turn the `json`/body options into a serialized payload and the matching
   * content-type headers
   */
  protected serializeBody(options: CallOptions): string | undefined {
    if (options.body === undefined) {
      return undefined;
    }

    if (typeof options.body === 'string') {
      return options.body;
    }

    if (options.json) {
      return JSON.stringify(options.body);
    }

    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(options.body)) {
      params.append(key, typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value));
    }

    return params.toString();
  }

  /**
   * Start the seeded session (when there is one) and return its cookie
   */
  protected seedSession(): { name: string; value: string } | null {
    if (this.sessionData === null) {
      return null;
    }

    if (!this.app.bound('session')) {
      throw new Error(
        'Cannot seed the session: register the SessionServiceProvider (and run the StartSession ' +
          'middleware) before calling withSession().'
      );
    }

    const manager = this.app.make<SessionManager>('session');
    const store = manager.store();

    store.start();

    for (const [key, value] of Object.entries(this.sessionData)) {
      store.put(key, value);
    }

    store.save();

    return { name: manager.getCookieName(), value: store.getCookieValue() };
  }

  /**
   * Copy the response's Set-Cookie entries into the jar
   */
  protected absorbCookies(setCookieHeaders: string[]): void {
    for (const header of setCookieHeaders) {
      const [pair, ...attributes] = header.split(';');
      const separator = pair.indexOf('=');

      if (separator === -1) {
        continue;
      }

      const name = safeDecode(pair.slice(0, separator).trim());
      const value = pair.slice(separator + 1).trim();

      const expired = attributes.some((attribute) => {
        const entry = attribute.trim().toLowerCase();

        return (
          entry === 'max-age=0' || (entry.startsWith('expires=') && new Date(entry.slice(8)).getTime() <= Date.now())
        );
      });

      if (expired || value === '') {
        this.jar.delete(name);
      } else {
        this.jar.set(name, safeDecode(value));
      }
    }
  }
}

/**
 * A ServerResponse double recording everything the Response wrapper writes
 */
function captureResponse(): {
  raw: ServerResponse;
  chunks: string[];
  headers: Record<string, string | string[]>;
  cookies: string[];
} {
  const raw = new ServerResponse(new IncomingMessage(new Socket()));
  const chunks: string[] = [];
  const headers: Record<string, string | string[]> = {};
  const cookies: string[] = [];

  raw.end = ((data?: any) => {
    if (data !== undefined && data !== null && data !== '') {
      chunks.push(typeof data === 'string' ? data : String(data));
    }

    return raw;
  }) as any;

  raw.setHeader = ((name: string, value: any) => {
    headers[name] = value;

    if (name.toLowerCase() === 'set-cookie') {
      cookies.push(...(Array.isArray(value) ? value.map(String) : [String(value)]));
    }

    return raw;
  }) as any;

  return { raw, chunks, headers, cookies };
}

/**
 * Percent-decode a cookie component, keeping the raw value when invalid
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
