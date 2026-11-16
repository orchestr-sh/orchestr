/**
 * TestResponse
 *
 * The Laravel-style assertion wrapper around a response captured from the
 * HTTP Kernel. The test client builds it from the recorded status, headers,
 * cookies and body plus the request that produced it, so session-based
 * assertions can read what the application actually stored.
 *
 * Mirrors Illuminate\Testing\TestResponse (the framework-side half of
 * Illuminate\Foundation\Testing\Concerns\MakesHttpRequests).
 */

import type { Request } from '@/Routing/Request';
import type { Store } from '@/Session/Contracts/Store';

/**
 * Everything the client captured from one round trip
 */
export interface TestResponseInit {
  status: number;
  headers: Record<string, string | string[]>;
  /** Raw Set-Cookie header values, in the order they were written */
  cookies: string[];
  body: string;
  /** The application request behind this response, when the client captured one */
  request?: Request;
  /** Intermediate responses of a followed redirect chain, oldest first */
  history?: TestResponse[];
}

/**
 * A parsed Set-Cookie entry
 */
export interface ParsedCookie {
  name: string;
  value: string;
  attributes: Record<string, string>;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonStructure = Record<string, any>;

export class TestResponse {
  public readonly status: number;
  public readonly headers: Record<string, string | string[]>;
  public readonly cookies: string[];
  public readonly content: string;

  /**
   * Responses produced before the final one when following redirects
   */
  public readonly history: TestResponse[];

  /**
   * The handled request; exposes the session for assertSessionHas et al
   */
  protected readonly handledRequest?: Request;

  private decodedJson?: JsonValue;
  private decodedJsonWasValid: boolean = false;

  constructor(init: TestResponseInit) {
    this.status = init.status;
    this.headers = init.headers;
    this.cookies = init.cookies;
    this.content = init.body;
    this.history = init.history ?? [];
    this.handledRequest = init.request;
  }

  // ==================== Accessors ====================

  /**
   * Parse the body as JSON
   * Laravel: $response->json()
   */
  json(): JsonValue {
    if (!this.decodedJsonWasValid) {
      try {
        this.decodedJson = JSON.parse(this.content === '' ? 'null' : this.content);
        this.decodedJsonWasValid = true;
      } catch {
        throw new Error(
          `Expected a JSON response but received (status ${this.status}):\n` + `${truncate(this.content)}`
        );
      }
    }

    return this.decodedJson as JsonValue;
  }

  /**
   * Alias of json(), like Laravel's decodeResponseJson
   */
  decodeResponseJson(): JsonValue {
    return this.json();
  }

  /**
   * The value of a response header (the first when several were written)
   * Laravel: $response->headers->get($name)
   */
  header(name: string): string | undefined {
    const value = this.lookupHeader(name);

    return Array.isArray(value) ? value[0] : value;
  }

  /**
   * All values written for a response header
   */
  headerValues(name: string): string[] {
    const value = this.lookupHeader(name);

    if (value === undefined) {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  }

  /**
   * The decoded value of a Set-Cookie entry
   * Laravel: cookies()->get($name)->getValue()
   */
  cookieValue(name: string): string | undefined {
    return this.parsedCookies().find((cookie) => cookie.name === name)?.value;
  }

  // ==================== Status assertions ====================

  /**
   * Assert the response carries the given status code
   * Laravel: assertStatus
   */
  assertStatus(status: number): this {
    if (this.status !== status) {
      throw new Error(
        `Expected response status code [${status}] but received ${this.status}:\n` + `${truncate(this.content)}`
      );
    }

    return this;
  }

  /**
   * Assert a 200 response
   * Laravel: assertOk
   */
  assertOk(): this {
    return this.assertStatus(200);
  }

  /**
   * Assert a 201 response
   * Laravel: assertCreated
   */
  assertCreated(): this {
    return this.assertStatus(201);
  }

  /**
   * Assert a 204 response with an empty body
   * Laravel: assertNoContent
   */
  assertNoContent(expectedLength: number = 0): this {
    this.assertStatus(204);

    if (expectedLength !== 0 && this.content.length !== expectedLength) {
      throw new Error(
        `Expected response body of length [${expectedLength}] but have [${this.content.length}]:` +
          `\n${truncate(this.content)}`
      );
    }

    if (expectedLength === 0 && this.content !== '') {
      throw new Error(`Expected empty response body but received [${truncate(this.content)}].`);
    }

    return this;
  }

  /**
   * Assert a 401 response
   * Laravel: assertUnauthorized
   */
  assertUnauthorized(): this {
    return this.assertStatus(401);
  }

  /**
   * Assert a 403 response
   * Laravel: assertForbidden
   */
  assertForbidden(): this {
    return this.assertStatus(403);
  }

  /**
   * Assert a 404 response
   * Laravel: assertNotFound
   */
  assertNotFound(): this {
    return this.assertStatus(404);
  }

  /**
   * Assert a 422 response
   * Laravel: assertUnprocessable
   */
  assertUnprocessable(): this {
    return this.assertStatus(422);
  }

  // ==================== Redirect assertions ====================

  /**
   * Assert the response is a redirect, optionally to the given URI
   * Laravel: assertRedirect
   */
  assertRedirect(location?: string, status: number = 302): this {
    if (!this.isRedirect()) {
      throw new Error(`Expected response to be a redirect but received status ${this.status}.`);
    }

    if (status !== 0) {
      this.assertStatus(status);
    }

    if (location !== undefined) {
      const actual = this.header('Location');

      if (actual !== location) {
        throw new Error(`Expected redirect location [${location}] but received [${String(actual)}].`);
      }
    }

    return this;
  }

  /**
   * Assert the response is not a redirect
   * Laravel: assertRedirectCount / the negative half of assertRedirect
   */
  assertNotRedirect(): this {
    if (this.isRedirect()) {
      throw new Error(
        `Did not expect response to be a redirect, but received status ${this.status} ` +
          `with Location [${String(this.header('Location'))}].`
      );
    }

    return this;
  }

  /**
   * Determine whether the response is a 3xx with a Location header
   */
  isRedirect(): boolean {
    return this.status >= 300 && this.status < 400 && this.header('Location') !== undefined;
  }

  /**
   * Assert the number of followed redirect responses
   * Laravel: assertRedirectCount
   */
  assertRedirectCount(expected: number): this {
    if (this.history.length !== expected) {
      throw new Error(`Expected [${expected}] redirected responses but received [${this.history.length}].`);
    }

    return this;
  }

  // ==================== Content assertions ====================

  /**
   * Assert the body contains the given text
   * Laravel: assertSee ($escape = true mirrors htmlspecialchars)
   */
  assertSee(value: string, escape: boolean = true): this {
    const needle = escape ? escapeHtml(value) : value;

    if (!this.content.includes(needle)) {
      throw new Error(
        `The string [${needle}] was not found in response.` +
          `\nResponse under test (status ${this.status}):\n${truncate(this.content)}`
      );
    }

    return this;
  }

  /**
   * Assert the body does not contain the given text
   * Laravel: assertDontSee
   */
  assertDontSee(value: string, escape: boolean = true): this {
    const needle = escape ? escapeHtml(value) : value;

    if (this.content.includes(needle)) {
      throw new Error(`The string [${needle}] unexpectedly appears in the response:\n${truncate(this.content)}`);
    }

    return this;
  }

  /**
   * Assert the body contains the text once tags are stripped
   * Laravel: assertSeeText
   */
  assertSeeText(value: string, escape: boolean = true): this {
    const text = stripTags(escape ? escapeHtml(value) : value);

    if (!stripTags(this.content).includes(text)) {
      throw new Error(
        `The text [${text}] was not found in response.` +
          `\nResponse under test (status ${this.status}):\n${truncate(this.content)}`
      );
    }

    return this;
  }

  /**
   * Assert the stripped body does not contain the text
   * Laravel: assertDontSeeText
   */
  assertDontSeeText(value: string, escape: boolean = true): this {
    const text = stripTags(escape ? escapeHtml(value) : value);

    if (stripTags(this.content).includes(text)) {
      throw new Error(`The text [${text}] unexpectedly appears in the response:\n${truncate(this.content)}`);
    }

    return this;
  }

  // ==================== JSON assertions ====================

  /**
   * Assert the JSON body contains the given subset, or satisfies the
   * callback
   * Laravel: assertJson
   */
  assertJson(expected: JsonValue | JsonStructure | ((data: JsonValue) => boolean) = {}): this {
    const data = this.json();

    if (typeof expected === 'function') {
      if (!expected(data)) {
        throw new Error(`The JSON response did not satisfy the provided callback:\n${truncate(JSON.stringify(data))}`);
      }

      return this;
    }

    const failures: string[] = [];

    assertSubset(data, expected, '', failures);

    if (failures.length > 0) {
      throw new Error(
        `Unable to find JSON fragment:\n\n${JSON.stringify(expected, null, 4)}\n\nwithin response:\n\n` +
          `${JSON.stringify(data, null, 4)}\n\n${failures.join('\n')}`
      );
    }

    return this;
  }

  /**
   * Assert the JSON body has the given value at the dot-notated path
   * ('*' matches every element of an array segment)
   * Laravel: assertJsonPath
   */
  assertJsonPath(path: string, expected: JsonValue | ((value: JsonValue) => boolean)): this {
    const values = this.valuesForPath(path);

    if (values.missing) {
      throw new Error(
        `Unable to find JSON: [${JSON.stringify({ [path]: expected })}] within response: ` +
          `\n${JSON.stringify(this.json())}`
      );
    }

    for (const value of values.found) {
      const matched = typeof expected === 'function' ? expected(value) : jsonEquals(value, expected);

      if (!matched) {
        throw new Error(
          `Unable to find JSON: [${JSON.stringify({ [path]: expected })}] within response: ` +
            `\n${JSON.stringify(this.json())}`
        );
      }
    }

    return this;
  }

  /**
   * Assert the JSON body has the given structure; '*' array markers check
   * every element against the nested shape
   * Laravel: assertJsonStructure
   */
  assertJsonStructure(structure: JsonStructure, data?: JsonValue): this {
    const body = data !== undefined ? data : this.json();
    const errors = checkStructure(body, structure, '');

    if (errors.length > 0) {
      throw new Error(
        `Unable to find JSON structure:\n\n${JSON.stringify(structure, null, 4)}\n\n` +
          `within response:\n\n${JSON.stringify(body, null, 4)}\n\n${errors.join('\n')}`
      );
    }

    return this;
  }

  /**
   * Assert a JSON array has the given number of items (the root array when
   * no key is supplied)
   * Laravel: assertJsonCount
   */
  assertJsonCount(count: number, key?: string): this {
    const target = key === undefined ? this.json() : this.valuesForPath(key).found[0];

    if (!Array.isArray(target)) {
      throw new Error(
        `The response ${key === undefined ? 'body' : `key [${key}]`} is not an array: ` + `${JSON.stringify(target)}`
      );
    }

    if (target.length !== count) {
      throw new Error(
        `Failed to assert that the response count matched the expected ${count} items, ` + `found ${target.length}.`
      );
    }

    return this;
  }

  // ==================== Header / cookie assertions ====================

  /**
   * Assert the response carries the header, with the given value when one
   * is supplied
   * Laravel: assertHeader
   */
  assertHeader(name: string, value?: string): this {
    const header = this.lookupHeader(name);

    if (header === undefined) {
      throw new Error(
        `The header [${name}] was not included in the response. ` +
          `Headers present: ${Object.keys(this.headers).join(', ') || 'none'}.`
      );
    }

    const actual = Array.isArray(header) ? header.join(', ') : header;

    if (value !== undefined && actual !== value) {
      throw new Error(`Expected response header [${name}] to be [${value}] but it is [${actual}].`);
    }

    return this;
  }

  /**
   * Assert the response does not carry the header
   * Laravel: assertHeaderMissing
   */
  assertHeaderMissing(name: string): this {
    if (this.lookupHeader(name) !== undefined) {
      throw new Error(`The header [${name}] unexpectedly appears in the response.`);
    }

    return this;
  }

  /**
   * Assert a cookie was set, with the given value when one is supplied
   * Laravel: assertCookie
   */
  assertCookie(name: string, value?: string): this {
    const cookie = this.parsedCookies().find((entry) => entry.name === name);

    if (!cookie) {
      const names = this.parsedCookies()
        .map((entry) => entry.name)
        .join(', ');

      throw new Error(`The cookie [${name}] is not present in the response. Cookies present: ${names || 'none'}.`);
    }

    if (value !== undefined && cookie.value !== value) {
      throw new Error(`Expected cookie [${name}] to be [${value}] but it is [${cookie.value}].`);
    }

    return this;
  }

  /**
   * Assert the given cookies were not set
   * Laravel: assertCookieMissing
   */
  assertCookieMissing(name: string): this {
    if (this.parsedCookies().some((entry) => entry.name === name)) {
      throw new Error(`The cookie [${name}] unexpectedly appears in the response.`);
    }

    return this;
  }

  // ==================== Session assertions ====================

  /**
   * The session store bound to the handled request
   */
  protected sessionStore(): Store {
    if (!this.handledRequest || !this.handledRequest.hasSession()) {
      throw new Error(
        'No session store was started for this request. Register the StartSession middleware ' +
          '(kernel.use(StartSession)) before asserting on session data.'
      );
    }

    return this.handledRequest.session();
  }

  /**
   * Assert the session contains the key, or each key/value pair of the
   * given record, or satisfies the callback
   * Laravel: assertSessionHas
   */
  assertSessionHas(key: string | Record<string, any> | ((session: Store) => boolean), value?: any): this {
    const session = this.sessionStore();

    if (typeof key === 'function') {
      if (!key(session)) {
        throw new Error('The session did not satisfy the provided callback.');
      }

      return this;
    }

    const pairs: Array<[string, any]> =
      typeof key === 'string' ? [[key, value]] : Object.entries(key).map(([k, v]) => [k, v]);

    for (const [sessionKey, expected] of pairs) {
      if (!session.has(sessionKey)) {
        throw new Error(
          `The session is missing expected key [${sessionKey}]. ` +
            `Keys present: ${Object.keys(session.all()).join(', ') || 'none'}.`
        );
      }

      if (expected !== undefined && !jsonEquals(session.get(sessionKey), expected)) {
        throw new Error(
          `The session value for key [${sessionKey}] was not the expected value ` +
            `(${JSON.stringify(expected)}); found ${JSON.stringify(session.get(sessionKey))}.`
        );
      }
    }

    return this;
  }

  /**
   * Assert the session does not contain the key
   * Laravel: assertSessionMissing
   */
  assertSessionMissing(key: string): this {
    const session = this.sessionStore();

    if (session.has(key)) {
      throw new Error(`The session should not have key [${key}], but it does.`);
    }

    return this;
  }

  /**
   * Assert the session's error bag contains the given keys/messages
   * Laravel: assertSessionHasErrors
   *
   * Accepted shapes: a key name, a record of `field: message | messages`,
   * or a callback receiving the error bag.
   */
  assertSessionHasErrors(key: string | Record<string, any> | ((errors: any) => boolean) = {}): this {
    const session = this.sessionStore();
    const errors = session.get('errors');

    if (errors === undefined || errors === null) {
      throw new Error('The session does not contain an error bag (the [errors] key is missing).');
    }

    if (typeof key === 'function') {
      if (!key(errors)) {
        throw new Error('The session error bag did not satisfy the provided callback.');
      }

      return this;
    }

    const bag: Record<string, any> = typeof errors === 'object' ? errors : {};
    const pairs: Array<[string, any]> = typeof key === 'string' ? [[key, undefined]] : Object.entries(key);

    for (const [field, messages] of pairs) {
      if (bag[field] === undefined) {
        throw new Error(
          `Session is missing expected key [errors.${field}]. ` +
            `Error keys present: ${Object.keys(bag).join(', ') || 'none'}.`
        );
      }

      if (messages !== undefined && !errorMessagesMatch(bag[field], messages)) {
        throw new Error(
          `Session error for [${field}] does not contain the expected message(s) ` +
            `${JSON.stringify(messages)}; found ${JSON.stringify(bag[field])}.`
        );
      }
    }

    return this;
  }

  /**
   * Assert the session has no validation errors
   * Laravel: assertSessionHasNoErrors
   */
  assertSessionHasNoErrors(): this {
    const session = this.sessionStore();
    const errors = session.get('errors');

    const hasErrors =
      errors !== undefined && errors !== null && typeof errors === 'object' && Object.keys(errors).length > 0;

    if (hasErrors) {
      throw new Error(`The session has an unexpected errors array: ${JSON.stringify(errors)}`);
    }

    return this;
  }

  // ==================== Internals ====================

  /**
   * Case-insensitive header lookup across the captured header bag
   */
  protected lookupHeader(name: string): string | string[] | undefined {
    const lowered = name.toLowerCase();

    for (const [key, value] of Object.entries(this.headers)) {
      if (key.toLowerCase() === lowered) {
        return value;
      }
    }

    return undefined;
  }

  /**
   * Parse every captured Set-Cookie header
   */
  protected parsedCookies(): ParsedCookie[] {
    return this.cookies.map((header) => parseSetCookie(header));
  }

  /**
   * Resolve the value(s) at a dot-notated path; '*' expands to every
   * element of an array
   */
  protected valuesForPath(path: string): { missing: boolean; found: JsonValue[] } {
    let current: JsonValue[] = [this.json()];

    for (const segment of path.split('.')) {
      const next: JsonValue[] = [];

      for (const item of current) {
        if (segment === '*') {
          if (Array.isArray(item)) {
            next.push(...item);
          }
          continue;
        }

        if (item !== null && typeof item === 'object') {
          if (Array.isArray(item)) {
            const index = Number(segment);

            if (Number.isInteger(index) && index >= 0 && index < item.length) {
              next.push(item[index]);
            }
          } else if (segment in item) {
            next.push((item as Record<string, JsonValue>)[segment]);
          }
        }
      }

      current = next;

      if (current.length === 0) {
        return { missing: true, found: [] };
      }
    }

    return { missing: false, found: current };
  }
}

/**
 * Compare decoded JSON against an expected subset, recording mismatches
 */
function assertSubset(actual: JsonValue, expected: any, path: string, failures: string[]): void {
  const label = path === '' ? 'the root' : `key [${path}]`;

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      failures.push(`Expected ${label} to be an array.`);
      return;
    }

    for (const [index, entry] of expected.entries()) {
      if (index >= actual.length) {
        failures.push(`Expected ${label} to contain an entry at index [${index}].`);
        continue;
      }

      assertSubset(actual[index], entry, joinPath(path, String(index)), failures);
    }

    return;
  }

  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
      failures.push(`Expected ${label} to be an object.`);
      return;
    }

    for (const [key, value] of Object.entries(expected)) {
      if (!(key in (actual as Record<string, JsonValue>))) {
        failures.push(`Expected ${label} to contain key [${key}].`);
        continue;
      }

      assertSubset((actual as Record<string, JsonValue>)[key], value, joinPath(path, key), failures);
    }

    return;
  }

  if (!jsonEquals(actual, expected)) {
    failures.push(`Value mismatch at ${label}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}.`);
  }
}

/**
 * Validate a JSON body against an expected structure ('*' array markers
 * included), returning the list of violations
 */
function checkStructure(data: JsonValue, structure: JsonStructure, path: string): string[] {
  const errors: string[] = [];

  for (const [key, expectation] of Object.entries(structure)) {
    const label = joinPath(path, key);

    if (key === '*') {
      continue;
    }

    if (data === null || typeof data !== 'object' || Array.isArray(data) || !(key in data)) {
      errors.push(`Missing expected key [${label}].`);
      continue;
    }

    const value = (data as Record<string, JsonValue>)[key];

    if (Array.isArray(expectation) && expectation.length === 1 && expectation[0] === '*') {
      if (!Array.isArray(value)) {
        errors.push(`Expected [${label}] to be an array.`);
        continue;
      }
    } else if (expectation !== null && typeof expectation === 'object' && !Array.isArray(expectation)) {
      errors.push(...checkStructure(value, expectation as JsonStructure, label));
    }
  }

  if (structure['*'] !== undefined && Array.isArray(data)) {
    const nested = structure['*'];

    if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
      for (const [index, item] of data.entries()) {
        errors.push(...checkStructure(item, nested as JsonStructure, `${path}[${index}]`));
      }
    }
  }

  return errors;
}

/**
 * Loose structural equality for decoded JSON values
 */
function jsonEquals(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }

  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return a === b;
  }

  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  return aKeys.every((key) => bKeys.includes(key) && jsonEquals(a[key], b[key]));
}

/**
 * Determine whether a session error entry contains the expected message(s)
 */
function errorMessagesMatch(actual: any, expected: any): boolean {
  const actualMessages: string[] = Array.isArray(actual) ? actual.map(String) : [String(actual)];

  const expectedMessages: string[] = Array.isArray(expected) ? expected.map(String) : [String(expected)];

  return expectedMessages.every((message) => actualMessages.includes(message));
}

/**
 * Join a dot-notation path segment
 */
function joinPath(prefix: string, segment: string): string {
  return prefix === '' ? segment : `${prefix}.${segment}`;
}

/**
 * Minimal HTML-escape matching Laravel's htmlspecialchars default flags
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Strip HTML tags for text assertions
 */
function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim();
}

/**
 * Parse one Set-Cookie header into its parts
 */
function parseSetCookie(header: string): ParsedCookie {
  const [pair, ...attributeParts] = header.split(';');
  const separator = pair.indexOf('=');
  const name = decodeComponent(pair.slice(0, separator).trim());
  const value = decodeComponent(pair.slice(separator + 1).trim());

  const attributes: Record<string, string> = {};

  for (const part of attributeParts) {
    const index = part.indexOf('=');
    const key = (index === -1 ? part : part.slice(0, index)).trim().toLowerCase();

    if (key) {
      attributes[key] = index === -1 ? 'true' : part.slice(index + 1).trim();
    }
  }

  return { name, value, attributes };
}

/**
 * Percent-decode a cookie component, keeping the raw value when invalid
 */
function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Keep assertion failures readable
 */
function truncate(body: string, limit: number = 600): string {
  return body.length > limit ? `${body.slice(0, limit)}…` : body;
}
