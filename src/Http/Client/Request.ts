/**
 * Request - the recorded view of an outbound HTTP request.
 *
 * Mirrors Illuminate\Http\Client\Request: PendingRequest builds one per
 * attempt and hands it to `beforeSending` callbacks, stub callbacks, the
 * recorder and every `Http.assertSent()` callback, so assertions talk to
 * a plain description of what was sent rather than to the fluent builder
 * that produced it (SRP: builders build, this just reports).
 *
 * `url` and `method` are properties (Laravel's magic `->url` /
 * `->method`); everything else reads through accessor methods.
 */

import type { CollectionKey } from '@/Support/Collection';
import { Arr } from '@/Support/Arr';

/**
 * One file part of a multipart request, as recorded for assertions.
 */
export interface RequestFile {
  /** Form field name the file was attached under */
  name: string;

  /** Reported filename, when the attachment carried one */
  filename?: string;

  /** Extra part headers (e.g. Content-Type) */
  headers?: Record<string, string>;

  /** Size in bytes of the attached content */
  size?: number;
}

export class Request {
  /** Absolute URL that was requested (query string included) */
  public readonly url: string;

  /** HTTP verb, upper-cased */
  public readonly method: string;

  constructor(
    url: string,
    method: string,
    protected readonly requestHeaders: Record<string, string> = {},
    protected readonly requestBody: string = '',
    protected readonly requestData: any = {},
    protected readonly requestFiles: RequestFile[] = [],
    protected readonly requestAttempt: number = 1,
    protected readonly requestOptions: Record<string, any> = {}
  ) {
    this.url = url;
    this.method = method;
  }

  /**
   * All request headers, keyed by lower-cased name.
   * Laravel: Request::$headers
   */
  headers(): Record<string, string> {
    return { ...this.requestHeaders };
  }

  /**
   * A single header value, case-insensitively; null when absent.
   * Laravel: Request::header()
   */
  header(name: string): string | null {
    const value = this.requestHeaders[name.toLowerCase()];

    return value === undefined ? null : value;
  }

  /**
   * The raw request body as sent (empty for bodyless and multipart
   * requests whose payload is binary).
   * Laravel: Request::body()
   */
  body(): string {
    return this.requestBody;
  }

  /**
   * The structured request data: parsed JSON / form fields, query
   * parameters for GET requests, or plain field values for multipart
   * requests.
   * Laravel: Request::data()
   */
  data(): any {
    return this.requestData;
  }

  /**
   * A value from the request data using "dot" notation.
   * Laravel: Request::input()
   */
  input<T = any>(key?: CollectionKey, defaultValue?: T): any {
    if (key === undefined || key === null) {
      return this.requestData;
    }

    return Arr.get(this.requestData, key, defaultValue);
  }

  /**
   * The multipart file parts, for `hasFile`/`file` assertions.
   * Laravel: Request::files()
   */
  files(): RequestFile[] {
    return [...this.requestFiles];
  }

  /**
   * Whether a file was attached under the given field name.
   * Laravel: Request::hasFile()
   */
  hasFile(name: string): boolean {
    return this.requestFiles.some((file) => file.name === name);
  }

  /**
   * The recorded metadata for one attached file.
   * Laravel: Request::file()
   */
  file(name: string): RequestFile | null {
    return this.requestFiles.find((file) => file.name === name) ?? null;
  }

  /**
   * Which attempt of a retrying request this record represents (1-based).
   * Laravel: Request::attemptNumber()
   */
  attemptNumber(): number {
    return this.requestAttempt;
  }

  /**
   * Whether the request carried a multipart body.
   */
  isMultipart(): boolean {
    return (this.requestHeaders['content-type'] ?? '').startsWith('multipart/');
  }

  /**
   * The transport-level options the request was sent with.
   * Laravel: Request::options()
   */
  options(): Record<string, any> {
    return { ...this.requestOptions };
  }
}
