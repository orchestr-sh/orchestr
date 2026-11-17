/**
 * Response - the Laravel-shaped wrapper over a raw HTTP response.
 *
 * Mirrors Illuminate\Http\Client\Response: the transport hands the
 * client a fully buffered TransportResponse, and this class turns it
 * into the interrogation surface applications know - status()/ok()/
 * successful()/failed()/clientError()/serverError(), json()/object()/
 * collect() for the body, header()/headers() for metadata, and throw()
 * to escalate failures into a RequestException.
 *
 * The body is decoded eagerly (as text) so responses stay synchronous
 * and safe to inspect after the fact - stubs and sinks included.
 */

import type { TransportResponse } from '@/Http/Client/Contracts/Transport';
import { RequestException } from '@/Http/Client/RequestException';
import { Arr } from '@/Support/Arr';
import { Collection } from '@/Support/Collection';
import type { Request } from './Request';

/**
 * Response headers accept plain values or repeated lists; lists join
 * with ", " the way HTTP itself folds them.
 */
export type ResponseHeaderBag = Record<string, string | string[]>;

export interface ResponseOptions {
  /** The outbound request this response answers */
  request?: Request;

  /** Transfer time in milliseconds, when known */
  time?: number;
}

export class Response {
  /** The decoded JSON body, parsed on first use */
  protected decoded: any;

  /** Whether `decoded` has been computed */
  protected decodedComputed: boolean = false;

  constructor(
    protected readonly rawBody: string | Uint8Array = '',
    protected readonly statusCode: number = 200,
    protected readonly responseHeaders: ResponseHeaderBag = {},
    protected readonly responseOptions: ResponseOptions = {}
  ) {}

  /**
   * Build a Response from the raw payload a Transport reported.
   */
  static fromTransport(transportResponse: TransportResponse, options: ResponseOptions = {}): Response {
    return new Response(transportResponse.body, transportResponse.status, transportResponse.headers, options);
  }

  /**
   * Build a Response from stub-style pieces: object bodies are
   * JSON-encoded (with a matching Content-Type), everything else
   * degrades to its text form.
   * Laravel: Factory::response() / Factory::psr7Response()
   */
  static make(body: any = '', status: number = 200, headers: ResponseHeaderBag = {}): Response {
    const allHeaders: ResponseHeaderBag = { ...headers };

    let text = '';

    if (body !== null && body !== undefined) {
      if (typeof body === 'object') {
        text = JSON.stringify(body);

        if (!Object.keys(allHeaders).some((name) => name.toLowerCase() === 'content-type')) {
          allHeaders['Content-Type'] = 'application/json';
        }
      } else {
        text = String(body);
      }
    }

    return new Response(text, status, allHeaders);
  }

  /**
   * The response body as text.
   * Laravel: Response::body()
   */
  body(): string {
    if (typeof this.rawBody === 'string') {
      return this.rawBody;
    }

    return new TextDecoder().decode(this.rawBody);
  }

  /**
   * Alias of body() - the raw response text.
   */
  text(): string {
    return this.body();
  }

  /**
   * The decoded JSON body, or a value from it using "dot" notation.
   * `defaultValue` answers missing keys (and unparseable bodies when no
   * key is given).
   * Laravel: Response::json()
   */
  json<T = any>(key?: string | null, defaultValue?: T): any {
    if (!this.decodedComputed) {
      try {
        this.decoded = JSON.parse(this.body());
      } catch {
        this.decoded = null;
      }

      this.decodedComputed = true;
    }

    if (key === undefined || key === null) {
      return this.decoded ?? defaultValue ?? null;
    }

    return Arr.get(this.decoded, key, defaultValue ?? null);
  }

  /**
   * The JSON body as a plain object / array (Laravel's ArrayObject
   * equivalent: the parsed value itself). Null for non-JSON bodies.
   * Laravel: Response::object()
   */
  object(): any {
    return this.json();
  }

  /**
   * The JSON body - or a slice of it - as a Collection.
   * Laravel: Response::collect()
   */
  collect(key?: string): Collection<any> {
    const value = key === undefined || key === null ? this.json() : this.json(key);

    if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
      return new Collection(value as any);
    }

    return new Collection(value === null || value === undefined ? [] : [value]);
  }

  /**
   * The status code.
   * Laravel: Response::status()
   */
  status(): number {
    return this.statusCode;
  }

  /**
   * Whether the response was a 200 "OK" response.
   * Laravel: Response::ok()
   */
  ok(): boolean {
    return this.status() === 200;
  }

  /**
   * Whether the status is a 2xx success code.
   * Laravel: Response::successful()
   */
  successful(): boolean {
    return this.status() >= 200 && this.status() < 300;
  }

  /**
   * Whether the response is a 1xx informational response.
   * Laravel: Response::informational()
   */
  informational(): boolean {
    return this.status() >= 100 && this.status() < 200;
  }

  /**
   * Whether the response is a 3xx redirect.
   * Laravel: Response::redirect()
   */
  redirect(): boolean {
    return this.status() >= 300 && this.status() < 400;
  }

  /**
   * Whether the response indicates a client or server error.
   * Laravel: Response::failed()
   */
  failed(): boolean {
    return this.clientError() || this.serverError();
  }

  /**
   * Whether the response is a 4xx client error.
   * Laravel: Response::clientError()
   */
  clientError(): boolean {
    return this.status() >= 400 && this.status() < 500;
  }

  /**
   * Whether the response is a 5xx server error.
   * Laravel: Response::serverError()
   */
  serverError(): boolean {
    return this.status() >= 500;
  }

  /**
   * A single response header, case-insensitively; the defaultValue - or
   * null - when the header is absent.
   * Laravel: Response::header()
   */
  header(name: string, defaultValue?: string): string | null {
    const value = this.headers()[name.toLowerCase()];

    return value === undefined ? (defaultValue ?? null) : value;
  }

  /**
   * All response headers, lower-cased and repeated values folded with
   * ", ".
   * Laravel: Response::headers()
   */
  headers(): Record<string, string> {
    const headers: Record<string, string> = {};

    for (const [name, value] of Object.entries(this.responseHeaders)) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    }

    return headers;
  }

  /**
   * Execute the callback if the request failed.
   * Laravel: Response::onError()
   */
  onError(callback: (response: Response) => unknown): this {
    if (this.failed()) {
      callback(this);
    }

    return this;
  }

  /**
   * The outbound request this response answers, when recorded.
   */
  request(): Request | undefined {
    return this.responseOptions.request;
  }

  /**
   * Transfer time in milliseconds, when the transport reported it.
   */
  time(): number | undefined {
    return this.responseOptions.time;
  }

  /**
   * Build (without throwing) the exception for a failed response.
   * Laravel: Response::toException()
   */
  toException(): RequestException | null {
    if (!this.failed()) {
      return null;
    }

    return new RequestException(this);
  }

  /**
   * Throw a RequestException when the response failed. The optional
   * callback receives the response and the exception (Laravel's
   * `Http::throw(fn)` seam) - throwing from the callback escalates
   * instead of the default RequestException.
   * Laravel: Response::throw()
   */
  throw(callback?: (response: Response, exception: RequestException) => unknown): this {
    const exception = this.toException();

    if (exception) {
      if (callback) {
        callback(this, exception);
      }

      throw exception;
    }

    return this;
  }

  /**
   * Throw only when the condition is truthy.
   * Laravel: Response::throwIf()
   */
  throwIf(
    condition: boolean | ((response: Response) => boolean),
    callback?: (response: Response, exception: RequestException) => unknown
  ): this {
    const truthy = typeof condition === 'function' ? condition(this) : condition;

    return truthy ? this.throw(callback) : this;
  }

  /**
   * Throw unless the condition is truthy.
   * Laravel: Response::throwUnless()
   */
  throwUnless(
    condition: boolean | ((response: Response) => boolean),
    callback?: (response: Response, exception: RequestException) => unknown
  ): this {
    const truthy = typeof condition === 'function' ? condition(this) : condition;

    return truthy ? this : this.throw(callback);
  }
}
