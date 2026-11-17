/**
 * PendingRequest - the fluent HTTP request builder and send pipeline.
 *
 * Mirrors Illuminate\Http\Client\PendingRequest: it *builds* (headers,
 * auth, cookies, body format, timeouts, retry policy, stubs) and
 * *sends* through the factory's Transport, owning exactly one place
 * for the retry loop, the timeout budget and the throw-on-failure rules
 * (DRY). Transport internals never leak out of here - the fluent API
 * and the assertions speak Laravel, the transport speaks plain data.
 *
 * Instances are created per entry point (`Http.get(...)` starts a fresh
 * one), so chaining config onto a verb never bleeds into the next
 * request - the same contract as Laravel's `Http::withToken(...)->get()`.
 *
 * @example
 * ```typescript
 * const response = await Http.withToken('secret').timeout(2.5).retry(3, 100).get(url);
 * ```
 */

import { randomBytes, createHash } from 'crypto';
import { writeFile } from 'fs/promises';
import type { Transport, TransportResponse } from '@/Http/Client/Contracts/Transport';
import type { Factory } from './Factory';
import type { RequestFile } from './Request';
import { ConnectionException } from './ConnectionException';
import { Request } from './Request';
import { RequestException } from './RequestException';
import { Response } from './Response';
import { Sequence } from './Sequence';
import { TimeoutException } from './TimeoutException';

/**
 * Anything a stub may answer with: a prepared Response, a JSON body,
 * a text body, a status code, a sequence, an exception to throw, a
 * callback producing one of these, or null/false to let the real
 * transport handle the request.
 */
export type StubValue =
  | Response
  | Sequence
  | Error
  | number
  | string
  | boolean
  | Record<string, any>
  | null
  | undefined
  | StubCallback;

/**
 * A stub callback, invoked with the recorded Request for each attempt.
 */
export type StubCallback = (request: Request) => StubValue | Promise<StubValue>;

/**
 * Callbacks registered via beforeSending().
 */
export type BeforeSendingCallback = (
  request: Request,
  pending: PendingRequest
) => Request | void | Promise<Request | void>;

/**
 * The retry decider: return true to retry the failed attempt.
 */
export type RetryWhenCallback = (
  exception: RequestException | ConnectionException,
  pending: PendingRequest,
  method?: string
) => boolean | Promise<boolean>;

/**
 * Callbacks registered via throw()/throwIf().
 */
export type ThrowCallback = (response: Response, exception: RequestException) => unknown;

/**
 * The condition evaluated before the throw callback escalates.
 */
export type ThrowIfCallback = (response: Response) => unknown;

/**
 * The retry delay: a fixed number of milliseconds, or a function of
 * the attempt number (1-based) and the failure being retried - the
 * seam for exponential backoff, `retry(3, (attempt) => attempt ** 2 * 100)`.
 */
export type RetryDelay = number | ((attempt: number, exception: unknown) => number);

/**
 * A file queued through attach().
 */
interface PendingFile {
  name: string;
  contents: Uint8Array;
  filename?: string;
  headers: Record<string, string>;
}

/**
 * The fully built payload of one attempt.
 */
interface RequestPayload {
  url: string;
  headers: Record<string, string>;
  body: string | Uint8Array | null;
  /** Structured request data, for the recorded Request */
  data: any;
  /** Multipart file parts, for the recorded Request */
  files: RequestFile[];
}

const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10;

export class PendingRequest {
  protected requestHeaders: Record<string, string> = {};

  protected queryParams: Record<string, any> = {};

  protected auth?: { type: 'basic' | 'digest'; username: string; password: string };

  protected cookieJar: Record<string, string> = {};

  /** Extra options handed to the transport (fetch init passthrough). */
  protected transportOptions: Record<string, any> = {};

  protected timeoutSeconds: number | null = DEFAULT_TIMEOUT_SECONDS;

  protected connectTimeoutSeconds: number | null = DEFAULT_CONNECT_TIMEOUT_SECONDS;

  protected tries: number | number[] = 1;

  protected retryDelay: RetryDelay = 100;

  protected retryThrow: boolean = true;

  protected retryWhenCallback?: RetryWhenCallback;

  protected throwCallback?: ThrowCallback;

  protected throwIfCallback?: ThrowIfCallback;

  protected bodyFormat: 'json' | 'form' | 'multipart' | 'body' = 'json';

  protected pendingBody: string | Uint8Array | null = null;

  protected pendingFiles: PendingFile[] = [];

  protected sinkPath?: string;

  protected baseUrlValue: string = '';

  protected beforeSendingCallbacks: BeforeSendingCallback[] = [];

  protected stubCallbacks: StubCallback[] = [];

  protected preventStray: boolean = false;

  protected allowedStrayUrls: string[] = [];

  constructor(protected factory: Factory) {
    // Laravel's PendingRequest boots in JSON mode with the Guzzle
    // defaults (timeout 30s, connect timeout 10s) in place.
    this.asJson();
  }

  // ==================== Fluent configuration ====================

  /**
   * Prefix relative URLs with this base.
   * Laravel: PendingRequest::baseUrl()
   */
  baseUrl(url: string): this {
    this.baseUrlValue = url;

    return this;
  }

  /**
   * Add query parameters to the request.
   * Laravel: PendingRequest::with()
   */
  with(query: Record<string, any>): this {
    Object.assign(this.queryParams, query);

    return this;
  }

  /**
   * Set request headers; names are matched case-insensitively and
   * re-adding one replaces it.
   * Laravel: PendingRequest::withHeaders()
   */
  withHeaders(headers: Record<string, any>): this {
    for (const [name, value] of Object.entries(headers)) {
      this.requestHeaders[name.toLowerCase()] = String(value);
    }

    return this;
  }

  /**
   * Set a single request header.
   * Laravel: PendingRequest::withHeader()
   */
  withHeader(name: string, value: any): this {
    return this.withHeaders({ [name]: value });
  }

  /**
   * Basic authentication: sends an `Authorization: Basic ...` header.
   * Laravel: PendingRequest::withBasicAuth()
   */
  withBasicAuth(username: string, password: string): this {
    this.auth = { type: 'basic', username, password };

    return this;
  }

  /**
   * Digest authentication: the client answers the server's 401
   * challenge with a computed `Authorization: Digest ...` header and
   * resends the request within the same attempt.
   * Laravel: PendingRequest::withDigestAuth()
   */
  withDigestAuth(username: string, password: string): this {
    this.auth = { type: 'digest', username, password };

    return this;
  }

  /**
   * Send a bearer (or custom-scheme) token.
   * Laravel: PendingRequest::withToken()
   */
  withToken(token: string, type: string = 'Bearer'): this {
    this.requestHeaders.authorization = `${type} ${token}`.trim();

    return this;
  }

  /**
   * Attach cookies, sent as a single Cookie header. The domain is
   * accepted for parity with Laravel but the client is origin-scoped,
   * so it is not used for matching.
   * Laravel: PendingRequest::withCookies()
   */
  withCookies(cookies: Record<string, string>, domain?: string): this {
    void domain;

    Object.assign(this.cookieJar, cookies);

    return this;
  }

  /**
   * Replace/merge low-level options. `timeout`, `connectTimeout`
   * (`connect_timeout`), `headers` and `query` are understood by the
   * client; anything else is handed to the transport (for the fetch
   * default: fetch init keys such as `redirect` or `keepalive`).
   * Laravel: PendingRequest::withOptions()
   */
  withOptions(options: Record<string, any>): this {
    for (const [name, value] of Object.entries(options)) {
      switch (name) {
        case 'timeout':
          this.timeoutSeconds = Number(value);
          break;
        case 'connectTimeout':
        case 'connect_timeout':
          this.connectTimeoutSeconds = Number(value);
          break;
        case 'headers':
          this.withHeaders(value as Record<string, any>);
          break;
        case 'query':
          this.with(value as Record<string, any>);
          break;
        default:
          this.transportOptions[name] = value;
      }
    }

    return this;
  }

  /**
   * Attach a raw body with the given content type.
   * Laravel: PendingRequest::withBody()
   */
  withBody(content: string | Uint8Array, contentType: string = 'application/json'): this {
    this.bodyFormat = 'body';
    this.pendingBody = content;
    this.withHeader('Content-Type', contentType);

    return this;
  }

  /**
   * The overall request timeout in seconds.
   * Laravel: PendingRequest::timeout()
   */
  timeout(seconds: number): this {
    this.timeoutSeconds = seconds;

    return this;
  }

  /**
   * The time budget for establishing the connection, in seconds.
   * Laravel: PendingRequest::connectTimeout()
   */
  connectTimeout(seconds: number): this {
    this.connectTimeoutSeconds = seconds;

    return this;
  }

  /**
   * Attempt the request a number of times before giving up.
   *
   * - `retry(3, 100)` tries three times with a 100ms pause between attempts.
   * - `retry(3, (attempt) => attempt ** 2 * 100)` backs off exponentially.
   * - `retry([100, 200, 400])` uses the array as the delay schedule,
   *   allowing one final attempt beyond it (Laravel's array form).
   * - `when` only re-attempts while the decider returns true.
   * - `throwOnExhaustion: false` hands back the last failed response
   *   instead of throwing when the attempts run out.
   *
   * Laravel: PendingRequest::retry()
   */
  retry(
    times: number | number[],
    sleepMilliseconds: RetryDelay = 100,
    when?: RetryWhenCallback,
    throwOnExhaustion: boolean = true
  ): this {
    this.tries = times;
    this.retryDelay = sleepMilliseconds;
    this.retryWhenCallback = when;
    this.retryThrow = throwOnExhaustion;

    return this;
  }

  /**
   * Decide which failures are worth another attempt.
   * Laravel: PendingRequest::retryWhen()
   */
  retryWhen(callback: RetryWhenCallback): this {
    this.retryWhenCallback = callback;

    return this;
  }

  /**
   * Throw (escalate via the callback) when a 4xx/5xx response arrives.
   * Laravel: PendingRequest::throw()
   */
  throw(callback?: ThrowCallback): this {
    this.throwCallback = callback ?? (() => undefined);

    return this;
  }

  /**
   * Throw on failure when the condition - boolean or callback over the
   * response - holds.
   * Laravel: PendingRequest::throwIf()
   */
  throwIf(condition: boolean | ThrowIfCallback, callback?: ThrowCallback): this {
    if (typeof condition === 'function') {
      this.throwIfCallback = condition;

      return this.throw(callback);
    }

    return condition ? this.throw(callback) : this;
  }

  /**
   * Throw on failure unless the condition holds.
   * Laravel: PendingRequest::throwUnless()
   */
  throwUnless(condition: boolean | ThrowIfCallback, callback?: ThrowCallback): this {
    if (typeof condition === 'function') {
      return this.throwIf((response) => !condition(response), callback);
    }

    return this.throwIf(!condition, callback);
  }

  /**
   * Send request data as JSON (the default).
   * Laravel: PendingRequest::asJson()
   */
  asJson(): this {
    this.bodyFormat = 'json';

    return this.withHeader('Content-Type', 'application/json');
  }

  /**
   * Send request data as `application/x-www-form-urlencoded`.
   * Laravel: PendingRequest::asForm()
   */
  asForm(): this {
    this.bodyFormat = 'form';

    return this.withHeader('Content-Type', 'application/x-www-form-urlencoded');
  }

  /**
   * Send request data (and attachments) as multipart form data. The
   * Content-Type carries the generated boundary at send time.
   * Laravel: PendingRequest::asMultipart()
   */
  asMultipart(): this {
    this.bodyFormat = 'multipart';

    delete this.requestHeaders['content-type'];

    return this;
  }

  /**
   * Attach a file part; implies a multipart request. Accepts the
   * Laravel tuple-array form as well.
   * Laravel: PendingRequest::attach()
   */
  attach(
    name: string | Array<{ name: string; contents?: any; filename?: string; headers?: Record<string, string> }>,
    contents: any = '',
    filename?: string,
    headers: Record<string, string> = {}
  ): this {
    if (Array.isArray(name)) {
      for (const file of name) {
        this.attach(file.name, file.contents, file.filename, file.headers);
      }

      return this;
    }

    this.asMultipart();

    this.pendingFiles.push({
      name,
      contents: toBytes(contents),
      filename: filename ?? inferFilename(name, contents),
      headers,
    });

    return this;
  }

  /**
   * Store the response body at this filesystem path.
   * Laravel: PendingRequest::sink()
   */
  sink(to: string): this {
    this.sinkPath = to;

    return this;
  }

  /**
   * The Accept header.
   * Laravel: PendingRequest::accept()
   */
  accept(contentType: string): this {
    return this.withHeaders({ Accept: contentType });
  }

  /**
   * Ask for JSON responses.
   * Laravel: PendingRequest::acceptJson()
   */
  acceptJson(): this {
    return this.accept('application/json');
  }

  /**
   * Run a callback with the recorded Request right before sending; it
   * may return a replacement Request.
   * Laravel: PendingRequest::beforeSending()
   */
  beforeSending(callback: BeforeSendingCallback): this {
    this.beforeSendingCallbacks.push(callback);

    return this;
  }

  /**
   * Install the factory's stub callbacks (fake support; Laravel copies
   * them onto the pending request the same way).
   */
  stub(callbacks: StubCallback[]): this {
    this.stubCallbacks = [...callbacks];

    return this;
  }

  /**
   * Fail unmatched requests instead of letting them reach the network.
   * Laravel: PendingRequest::preventStrayRequests()
   */
  preventStrayRequests(prevent: boolean = true): this {
    this.preventStray = prevent;

    return this;
  }

  /**
   * Allow specific URL patterns past the stray guard.
   * Laravel: PendingRequest::allowStrayRequests()
   */
  allowStrayRequests(only: string[] = []): this {
    this.allowedStrayUrls = only;

    return this;
  }

  // ==================== Verbs ====================

  /**
   * GET - the second argument is merged into the query string.
   * Laravel: PendingRequest::get()
   */
  get(url: string, query?: string | Record<string, any>): Promise<Response> {
    return this.send('GET', url, { query });
  }

  /**
   * HEAD.
   * Laravel: PendingRequest::head()
   */
  head(url: string, query?: string | Record<string, any>): Promise<Response> {
    return this.send('HEAD', url, { query });
  }

  /**
   * OPTIONS.
   * Laravel: the HTTP verb of the same name
   */
  options(url: string, query?: string | Record<string, any>): Promise<Response> {
    return this.send('OPTIONS', url, { query });
  }

  /**
   * POST, body encoded per the current format (JSON by default).
   * Laravel: PendingRequest::post()
   */
  post(url: string, data: any = {}): Promise<Response> {
    return this.send('POST', url, { data });
  }

  /**
   * PUT.
   * Laravel: PendingRequest::put()
   */
  put(url: string, data: any = {}): Promise<Response> {
    return this.send('PUT', url, { data });
  }

  /**
   * PATCH.
   * Laravel: PendingRequest::patch()
   */
  patch(url: string, data: any = {}): Promise<Response> {
    return this.send('PATCH', url, { data });
  }

  /**
   * DELETE - the body is only sent when data is provided, as in
   * Laravel.
   * Laravel: PendingRequest::delete()
   */
  delete(url: string, data: any = {}): Promise<Response> {
    return Object.keys(data ?? {}).length === 0 ? this.send('DELETE', url) : this.send('DELETE', url, { data });
  }

  /**
   * Send any method. `options.data` distinguishes "no body" from an
   * explicit empty payload, matching Laravel's delete()-omits-body rule
   * while post/put/patch default to `{}`.
   * Laravel: PendingRequest::send()
   */
  async send(
    method: string,
    url: string,
    options: { query?: string | Record<string, any>; data?: any } = {}
  ): Promise<Response> {
    const target = this.resolveUrl(url);
    const query = this.mergeQuery(options.query);
    const data = options.data ?? null;

    const totalTries = Array.isArray(this.tries) ? this.tries.length + 1 : Math.max(1, this.tries);
    const backoffSchedule = Array.isArray(this.tries) ? this.tries : [];

    // Bridges the response-path retry decision into the shared loop,
    // exactly like Laravel's $shouldRetry closure.
    let responseShouldRetry: boolean | null = null;

    for (let attempt = 1; ; attempt++) {
      let failure: unknown = null;

      try {
        const response = await this.transfer(method, target, data, query, attempt);

        if (response.successful()) {
          return response;
        }

        const exception = response.toException() ?? new RequestException(response);

        try {
          responseShouldRetry = this.retryWhenCallback ? await this.retryWhenCallback(exception, this, method) : true;
        } catch (whenFailure) {
          responseShouldRetry = false;

          throw whenFailure;
        }

        if (this.throwCallback && (this.throwIfCallback === undefined || this.throwIfCallback(response))) {
          response.throw(this.throwCallback);
        }

        if (attempt < totalTries && responseShouldRetry) {
          response.throw();
        }

        if (totalTries > 1 && this.retryThrow) {
          response.throw();
        }

        return response;
      } catch (error) {
        failure = error;
      }

      const shouldRetry =
        responseShouldRetry !== null
          ? responseShouldRetry
          : this.retryWhenCallback
            ? await this.retryWhenCallback(failure as RequestException, this, method)
            : true;

      responseShouldRetry = null;

      if (attempt >= totalTries || !shouldRetry) {
        throw failure;
      }

      const delayMs = this.retryDelayFor(attempt, failure, backoffSchedule);

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  // ==================== Internals ====================

  /**
   * One attempt: build, run beforeSending hooks, consult stubs (fake)
   * or the transport, apply the sink, and record the pair.
   */
  protected async transfer(
    method: string,
    url: string,
    data: any,
    query: Record<string, any>,
    attempt: number
  ): Promise<Response> {
    const payload = this.buildPayload(method, url, data, query);

    let request = new Request(
      payload.url,
      method,
      payload.headers,
      typeof payload.body === 'string' ? payload.body : '',
      payload.data,
      payload.files,
      attempt,
      this.transportOptions
    );

    try {
      for (const callback of this.beforeSendingCallbacks) {
        const replacement = await callback(request, this);

        if (replacement instanceof Request) {
          request = replacement;
        }
      }

      const response = await this.resolveResponse(method, request, payload);

      if (this.sinkPath) {
        await writeFile(this.sinkPath, response.body());
      }

      this.factory.recordRequestResponsePair(request, response);

      return response;
    } catch (error) {
      // Connection failures get recorded without a response, matching
      // Laravel's marshalConnectionException().
      if (error instanceof ConnectionException) {
        this.factory.recordRequestResponsePair(request, null);
      }

      throw error;
    }
  }

  /**
   * Stubs first (when faking), then the real transport; unmatched
   * requests either trip the stray guard or pass through.
   */
  protected async resolveResponse(method: string, request: Request, payload: RequestPayload): Promise<Response> {
    if (this.stubCallbacks.length > 0) {
      const stubbed = await this.resolveStub(request);

      if (stubbed) {
        return stubbed;
      }

      if (this.preventStray && !this.isAllowedStrayUrl(request.url)) {
        throw new Error(`Call to unexpected and unmocked HTTP method [${method}] with the URI [${request.url}].`);
      }
    }

    return this.sendViaTransport(request, payload);
  }

  /**
   * Walk the stub table; callbacks returning null/false/undefined let
   * the next stub - and eventually the transport - take over.
   */
  protected async resolveStub(request: Request): Promise<Response | null> {
    for (const callback of this.stubCallbacks) {
      const value = await callback(request);

      if (value === null || value === undefined || value === false) {
        continue;
      }

      const resolved = await this.materializeStub(value, request);

      if (resolved) {
        return resolved;
      }
    }

    return null;
  }

  /**
   * Turn one stub value into a Response, unwrapping callbacks,
   * sequences and exception stubs along the way.
   */
  protected async materializeStub(value: StubValue, request: Request): Promise<Response | null> {
    if (value instanceof Response) {
      return value;
    }

    if (value instanceof Sequence) {
      return this.materializeStub(value.next(request), request);
    }

    if (value instanceof Error) {
      throw value;
    }

    if (typeof value === 'function') {
      return this.materializeStub(await (value as StubCallback)(request), request);
    }

    if (typeof value === 'number') {
      // Laravel treats 100-599 as a bare status code; anything else is
      // a (stringified) body.
      return value >= 100 && value < 600 ? Response.make('', value) : Response.make(String(value));
    }

    if (typeof value === 'boolean') {
      return Response.make('', value ? 200 : 204);
    }

    if (typeof value === 'string') {
      return Response.make(value);
    }

    const record = value as Record<string, any>;

    const looksLikeEnvelope =
      typeof record.status === 'number' || record.body !== undefined || record.headers !== undefined;

    if (looksLikeEnvelope) {
      const status = Number(record.status ?? 200);

      return Response.make(record.body ?? '', status, (record.headers ?? {}) as Record<string, string>);
    }

    return Response.make(record);
  }

  /**
   * Hand the built payload to the transport under the request's
   * timeout budget, answer digest 401 challenges, and wrap failures
   * into Connection/Timeout exceptions.
   */
  protected async sendViaTransport(request: Request, payload: RequestPayload): Promise<Response> {
    const startedAt = Date.now();
    const transport = this.factory.getTransport();

    const controller = new AbortController();

    const totalMs = this.timeoutSeconds === null ? 0 : Math.max(0, this.timeoutSeconds * 1000);

    const timeoutTimer = totalMs
      ? setTimeout(() => {
          controller.abort(
            new TimeoutException(`Request to [${request.method} ${request.url}] timed out after ${totalMs}ms.`)
          );
        }, totalMs)
      : undefined;

    // Rejects the moment the budget expires; the no-op catch keeps it
    // "handled" when the transport answers first.
    let rejectAborted: (reason: unknown) => void = () => {};

    const aborted = new Promise<never>((_, reject) => {
      rejectAborted = reject;
    });

    aborted.catch(() => {});

    controller.signal.addEventListener('abort', () => rejectAborted(controller.signal.reason), { once: true });

    const forAttempt = (headers: Record<string, any>): Promise<TransportResponse> =>
      transport.send({
        method: request.method,
        url: payload.url,
        headers,
        body: payload.body,
        timeout: this.timeoutSeconds ?? undefined,
        connectTimeout: this.connectTimeoutSeconds ?? undefined,
        signal: controller.signal,
        options: this.transportOptions,
      });

    try {
      let transportResponse = await Promise.race([forAttempt(payload.headers), aborted]);

      transportResponse = await this.answerDigestChallenge(
        transportResponse,
        request,
        payload,
        transport,
        forAttempt,
        aborted
      );

      return Response.fromTransport(transportResponse, { request, time: Date.now() - startedAt });
    } catch (error) {
      throw this.classifyTransportError(error, request);
    } finally {
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
      }
    }
  }

  /**
   * When digest auth is configured and the server answered 401 with a
   * Digest challenge, compute the response and resend - within the
   * same attempt, the way Guzzle's digest middleware behaves.
   */
  protected async answerDigestChallenge(
    transportResponse: TransportResponse,
    request: Request,
    payload: RequestPayload,
    transport: Transport,
    forAttempt: (headers: Record<string, any>) => Promise<TransportResponse>,
    aborted: Promise<never>
  ): Promise<TransportResponse> {
    if (this.auth?.type !== 'digest' || transportResponse.status !== 401) {
      return transportResponse;
    }

    const challenge = parseDigestChallenge(transportResponse.headers['www-authenticate']);

    if (!challenge) {
      return transportResponse;
    }

    const authorization = computeDigestAuthorization({
      challenge,
      username: this.auth.username,
      password: this.auth.password,
      method: request.method,
      url: payload.url,
      body: typeof payload.body === 'string' ? payload.body : '',
    });

    if (!authorization) {
      return transportResponse;
    }

    return Promise.race([forAttempt({ ...payload.headers, authorization }), aborted]);
  }

  /**
   * Map transport rejections onto the Laravel exception classes.
   * Timeouts and connection failures arrive as (sub)classes of
   * RequestException already; anything else is a connection failure.
   */
  protected classifyTransportError(error: unknown, request: Request): unknown {
    if (error instanceof RequestException) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);

    return new ConnectionException(
      `A connection could not be established with [${request.method} ${request.url}]: ${message}`,
      { cause: error }
    );
  }

  /**
   * Assemble the absolute URL, final headers and encoded body.
   */
  protected buildPayload(method: string, url: string, data: any, query: Record<string, any>): RequestPayload {
    const headers: Record<string, string> = { ...this.requestHeaders };

    for (const [name, value] of Object.entries(this.cookieJar)) {
      const pair = `${name}=${encodeURIComponent(value)}`;

      headers.cookie = headers.cookie ? `${headers.cookie}; ${pair}` : pair;
    }

    const fullUrl = appendQuery(url, query);

    if (this.auth?.type === 'basic') {
      headers.authorization = `Basic ${Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64')}`;
    }

    let body: string | Uint8Array | null = null;

    let recordData: any = data;

    const files: RequestFile[] = [];

    const sendsBody = !['GET', 'HEAD', 'OPTIONS'].includes(method);

    if (this.bodyFormat === 'body') {
      body = this.pendingBody;
      recordData = {};
    } else if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      // Query parameters are the request data for GET-style calls,
      // like Laravel's parseRequestData().
      recordData = parseUrlQuery(fullUrl);
    } else if (this.bodyFormat === 'form') {
      body = data === null ? null : encodeForm(data);
      recordData = data ?? {};
    } else if (this.bodyFormat === 'multipart') {
      const encoded = encodeMultipart(data, this.pendingFiles);

      body = encoded.body;
      headers['content-type'] = `multipart/form-data; boundary=${encoded.boundary}`;

      for (const file of this.pendingFiles) {
        files.push({ name: file.name, filename: file.filename, headers: file.headers, size: file.contents.length });
      }

      recordData = fieldsOnly(data);
    } else {
      body = data === null ? null : JSON.stringify(data);
      recordData = data ?? {};
    }

    if (!sendsBody && this.bodyFormat !== 'body') {
      // GET/HEAD/OPTIONS never carry a body; the format's
      // Content-Type header remains, as Guzzle leaves it too.
      body = null;
    }

    return { url: fullUrl, headers, body, data: recordData, files };
  }

  /**
   * Absolute URL: relative paths join onto the configured base, like
   * Laravel's send().
   */
  protected resolveUrl(url: string): string {
    if (/^https?:\/\//.test(url)) {
      return url;
    }

    return `${this.baseUrlValue.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
  }

  /**
   * Merge with()-parameters with per-verb query arguments.
   */
  protected mergeQuery(query?: string | Record<string, any>): Record<string, any> {
    const merged: Record<string, any> = { ...this.queryParams };

    if (typeof query === 'string') {
      for (const [name, value] of new URLSearchParams(query)) {
        merged[name] = value;
      }
    } else if (query) {
      Object.assign(merged, query);
    }

    return merged;
  }

  /**
   * Resolve the pause before the next attempt: an explicit schedule
   * entry wins over the configured delay, closures receive the attempt
   * number and the failure (exponential backoff hook).
   */
  protected retryDelayFor(attempt: number, failure: unknown, backoffSchedule: number[]): number {
    // Bounds-checked (rather than indexed-??-fallback) so the closure
    // form of the union survives narrowing.
    const delay: number | RetryDelay =
      attempt - 1 < backoffSchedule.length ? backoffSchedule[attempt - 1] : this.retryDelay;

    const milliseconds = typeof delay === 'function' ? delay(attempt, failure) : delay;

    return Math.max(0, Math.round(milliseconds));
  }

  /**
   * Whether a stray request slips past the guard via an allowed
   * pattern.
   */
  protected isAllowedStrayUrl(url: string): boolean {
    return this.allowedStrayUrls.some((pattern) => globMatches(pattern, url));
  }
}

// ==================== Helpers ====================

/**
 * Convert attach() content into bytes.
 */
function toBytes(contents: any): Uint8Array {
  if (contents instanceof Uint8Array) {
    return contents;
  }

  if (Buffer.isBuffer(contents)) {
    return new Uint8Array(contents);
  }

  return new TextEncoder().encode(String(contents ?? ''));
}

/**
 * Laravel only records a filename for attachments when given one;
 * string contents without a filename stay plain parts.
 */
function inferFilename(name: string, contents: any): string | undefined {
  return contents instanceof Uint8Array || Buffer.isBuffer(contents) ? name : undefined;
}

/**
 * Multipart file parts carry string bodies as text fields.
 */
function fieldsOnly(data: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};

  for (const [name, value] of Object.entries(data ?? {})) {
    if (!(value instanceof Uint8Array)) {
      fields[name] = value;
    }
  }

  return fields;
}

/**
 * Encode `application/x-www-form-urlencoded` bodies; nested objects
 * and arrays use bracket notation like http_build_query.
 */
function encodeForm(data: Record<string, any>): string {
  const params = new URLSearchParams();

  appendFormEntries(params, '', data ?? {});

  return params.toString();
}

function appendFormEntries(params: URLSearchParams, prefix: string, value: any): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      appendFormEntries(params, `${prefix}[]`, item);
    }

    return;
  }

  if (value !== null && typeof value === 'object') {
    for (const [name, nested] of Object.entries(value)) {
      appendFormEntries(params, prefix ? `${prefix}[${name}]` : name, nested);
    }

    return;
  }

  params.append(prefix, String(value ?? ''));
}

/**
 * Encode a multipart body with its boundary. Parts carry the same
 * Content-Disposition/extra-header shape browsers and servers expect.
 */
function encodeMultipart(data: Record<string, any>, files: PendingFile[]): { body: Uint8Array; boundary: string } {
  const boundary = `----OrchestrFormBoundary${randomBytes(8).toString('hex')}`;

  const encoder = new TextEncoder();

  const chunks: Uint8Array[] = [];

  const push = (value: string | Uint8Array): void => {
    chunks.push(typeof value === 'string' ? encoder.encode(value) : value);
  };

  const appendPart = (
    name: string,
    contents: Uint8Array,
    filename?: string,
    headers: Record<string, string> = {}
  ): void => {
    let disposition = `Content-Disposition: form-data; name="${name}"`;

    if (filename) {
      disposition += `; filename="${filename}"`;
    }

    push(`--${boundary}\r\n${disposition}\r\n`);

    for (const [header, value] of Object.entries(headers)) {
      push(`${header}: ${value}\r\n`);
    }

    push('\r\n');
    push(contents);
    push('\r\n');
  };

  for (const [name, value] of Object.entries(data ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        appendPart(`${name}[]`, toBytes(item));
      }

      continue;
    }

    appendPart(name, toBytes(value), value instanceof Uint8Array || Buffer.isBuffer(value) ? name : undefined);
  }

  for (const file of files) {
    appendPart(file.name, file.contents, file.filename, file.headers);
  }

  push(`--${boundary}--\r\n`);

  return { body: concatBytes(chunks), boundary };
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);

  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Append query parameters using bracket notation for nested values.
 */
function appendQuery(url: string, query: Record<string, any>): string {
  const entries = Object.entries(query ?? {});

  if (entries.length === 0) {
    return url;
  }

  const params = new URLSearchParams();

  for (const [name, value] of entries) {
    appendFormEntries(params, name, value);
  }

  const separator = url.includes('?') ? '&' : '?';

  return `${url}${separator}${params.toString()}`;
}

/**
 * The parsed query string of a URL, as recorded request data.
 */
function parseUrlQuery(url: string): Record<string, any> {
  try {
    const result: Record<string, any> = {};

    for (const [name, value] of new URL(url).searchParams) {
      if (result[name] === undefined) {
        result[name] = value;
      } else {
        result[name] = Array.isArray(result[name]) ? [...result[name], value] : [result[name], value];
      }
    }

    return result;
  } catch {
    return {};
  }
}

/**
 * Glob match with `*` wildcards, mirroring Laravel's Str::is for the
 * patterns the stray guard accepts.
 */
function globMatches(pattern: string, value: string): boolean {
  if (!pattern.includes('*')) {
    return pattern === value;
  }

  return new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a `WWW-Authenticate: Digest ...` challenge into its parameters.
 */
function parseDigestChallenge(header?: string): Record<string, string> | null {
  if (!header || !/^digest\b/i.test(header)) {
    return null;
  }

  const params: Record<string, string> = {};

  const pattern = /(\w+)=(?:"([^"]*)"|([^",\s]+))/g;

  let match: RegExpExecArray | null;

  while ((match = pattern.exec(header.slice(6))) !== null) {
    params[match[1].toLowerCase()] = match[2] ?? match[3] ?? '';
  }

  return params;
}

/**
 * Compute an RFC 2617 digest Authorization header value.
 */
function computeDigestAuthorization(input: {
  challenge: Record<string, string>;
  username: string;
  password: string;
  method: string;
  url: string;
  body: string;
}): string | null {
  const { challenge, username, password, method, url } = input;

  if (!challenge.nonce || !challenge.realm) {
    return null;
  }

  const algorithm = (challenge.algorithm ?? 'MD5').toUpperCase();

  const hash = (value: string): string => {
    const digest = createHash(algorithm === 'SHA-256' || algorithm === 'SHA256' ? 'sha256' : 'md5');

    return digest.update(value).digest('hex');
  };

  const uri = (() => {
    try {
      const parsed = new URL(url);

      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return url;
    }
  })();

  const ha1 = hash(`${username}:${challenge.realm}:${password}`);

  const ha2 = hash(`${method}:${uri}`);

  const qopValue = (challenge.qop ?? '')
    .split(',')
    .map((value) => value.trim())
    .includes('auth-int')
    ? 'auth-int'
    : (challenge.qop ?? '').includes('auth')
      ? 'auth'
      : '';

  let response: string;

  const parts: Array<[name: string, value: string, quoted?: boolean]> = [
    ['username', username],
    ['realm', challenge.realm],
    ['nonce', challenge.nonce],
    ['uri', uri],
    ['algorithm', challenge.algorithm ?? 'MD5'],
  ];

  if (qopValue) {
    const nc = '00000001';
    const cnonce = randomBytes(8).toString('hex');

    response = hash(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qopValue}:${ha2}`);

    // RFC 7616: qop and nc are tokens, everything else is a quoted string.
    parts.push(['qop', qopValue, false], ['nc', nc, false], ['cnonce', cnonce]);
  } else {
    response = hash(`${ha1}:${challenge.nonce}:${ha2}`);
  }

  if (challenge.opaque) {
    parts.push(['opaque', challenge.opaque]);
  }

  const fields = parts.map(([name, value, quoted = true]) => (quoted ? `${name}="${value}"` : `${name}=${value}`));

  return `Digest ${fields.concat(`response="${response}"`).join(', ')}`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
