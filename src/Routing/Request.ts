import type { TLSSocket } from 'tls';
import { IncomingMessage } from 'http';
import { parse as parseQuery } from 'querystring';
import { parse as parseUrl } from 'url';
import type { Response } from '@/Auth/Access/Response';
import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { StatefulGuard } from '@/Auth/Contracts/Guard';
import type { ValidationRules } from '@/Foundation/Http/Validator';
import type { Store as SessionStore } from '@/Session/Contracts/Store';
import { resolveGate } from '@/Auth/Access/Gate';
import { ValidationException } from '@/Foundation/Http/ValidationException';
import { Validator } from '@/Foundation/Http/Validator';
import { FileUploadException } from './FileUploadException';
import { DEFAULT_MAX_BODY_SIZE, multipartBoundary, parseMultipart } from './MultipartParser';
import { Route } from './Route';
import { UploadedFile } from './UploadedFile';

/**
 * Resolves the authenticated user for a guard, or the default guard
 * Laravel: the callable behind Illuminate\Http\Request::user()
 */
export type UserResolver = (guard?: string) => Authenticatable | null | Promise<Authenticatable | null>;

/**
 * Resolves the guard handling a request
 */
export type GuardResolver = (guard?: string) => StatefulGuard;

/**
 * The proxy-trust boundary a request consults to decide whether
 * `X-Forwarded-*` headers may override what the socket says. The TrustProxies
 * middleware installs one (an implementation backed by the `trustedproxy`
 * configuration); without it nothing is forwarded and every value comes from
 * the socket and the request's own headers.
 * Laravel: Symfony's Request::setTrustedProxies() header trust semantics
 */
export interface ProxyTrust {
  /**
   * Whether an IP address belongs to a proxy the application trusts
   */
  isTrustedProxy(ip: string | undefined): boolean;

  /**
   * Whether a forwarded header (lowercase) is in the configured set
   */
  trusts(header: string): boolean;
}

/**
 * Body limits honoured while parsing multipart uploads
 */
export interface ParseBodyOptions {
  /** Maximum bytes buffered for a single file part */
  maxFileSize?: number;
  /** Maximum bytes collected for a multipart body */
  maxBodySize?: number;
}

/**
 * Request - Laravel's HTTP Request wrapper
 * Illuminate\Http\Request
 */
export class Request {
  public raw: IncomingMessage;
  public method: string;
  public url: string;
  public path: string;
  public query: Record<string, any> = {};
  public params: Record<string, any> = {};
  public headers: Record<string, string | string[] | undefined>;
  public body: any = {};

  private matchedRoute?: Route;

  private sessionStore?: SessionStore;

  private userResolver?: UserResolver;

  private guardResolver?: GuardResolver;

  /**
   * The proxy trust boundary installed by the TrustProxies middleware;
   * without it all forwarded headers are treated as untrusted input
   */
  private proxyTrust?: ProxyTrust;

  private bodyParsed: boolean = false;

  /**
   * Files carried by a multipart body, keyed by input name
   * Laravel: the request's UploadedFile parameter bag
   */
  private uploadedFiles: Record<string, UploadedFile | UploadedFile[]> = {};

  constructor(req: IncomingMessage) {
    this.raw = req;
    this.method = req.method || 'GET';
    this.url = req.url || '/';
    this.headers = req.headers as Record<string, string | string[] | undefined>;

    // Parse URL and query string
    const parsed = parseUrl(this.url, true);
    this.path = parsed.pathname || '/';
    this.query = parsed.query as Record<string, any>;
  }

  /**
   * Parse the request body
   *
   * JSON and urlencoded bodies land in `body`; multipart/form-data fills
   * `body` with its text fields and the file bag with its uploads. Buffer
   * limits are honoured for multipart bodies: collection stops once the
   * configured ceiling is crossed and the parse rejects.
   */
  async parseBody(options: ParseBodyOptions = {}): Promise<void> {
    if (this.bodyParsed) {
      return;
    }

    const contentType = this.header('content-type') || '';
    const isMultipart = contentType.includes('multipart/form-data');
    const maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let received = 0;
      let overflowed = false;

      this.raw.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buffer.byteLength;

        if (isMultipart && received > maxBodySize) {
          // Stop buffering; the error surfaces when the stream ends
          overflowed = true;
          return;
        }

        chunks.push(buffer);
      });

      this.raw.on('end', () => {
        try {
          if (overflowed) {
            throw new FileUploadException(`Multipart body of ${received} bytes exceeds the ${maxBodySize} byte limit.`);
          }

          const raw = Buffer.concat(chunks);

          if (isMultipart) {
            const boundary = multipartBoundary(contentType);

            if (!boundary) {
              throw new FileUploadException('Multipart form-data request is missing its boundary parameter.');
            }

            const { fields, files } = parseMultipart(raw, boundary, {
              maxFileSize: options.maxFileSize,
              maxBodySize,
            });

            this.body = fields;
            this.uploadedFiles = files;
          } else if (contentType.includes('application/json')) {
            this.body = raw.byteLength ? JSON.parse(raw.toString()) : {};
          } else if (contentType.includes('application/x-www-form-urlencoded')) {
            this.body = parseQuery(raw.toString());
          } else {
            this.body = raw.toString();
          }

          this.bodyParsed = true;
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      this.raw.on('error', reject);
    });
  }

  /**
   * Get a header value
   * Laravel: $request->header('content-type')
   */
  header(name: string, defaultValue?: string): string | undefined {
    const value = this.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value || defaultValue;
  }

  /**
   * Parse the request's Cookie header
   * Laravel: $request->cookie() / the cookie bag
   */
  cookies(): Record<string, string> {
    const parsed: Record<string, string> = {};

    for (const pair of (this.header('cookie') ?? '').split(';')) {
      const separator = pair.indexOf('=');

      if (separator === -1) {
        continue;
      }

      const name = pair.slice(0, separator).trim();

      if (name) {
        parsed[decodeCookieComponent(name)] = decodeCookieComponent(pair.slice(separator + 1).trim());
      }
    }

    return parsed;
  }

  /**
   * Get a cookie value from the request
   * Laravel: $request->cookie('name', 'default')
   */
  cookie(name: string, defaultValue?: string): string | undefined {
    return this.cookies()[name] ?? defaultValue;
  }

  /**
   * The session store bound to this request by the session middleware
   * Laravel: $request->session()
   */
  session(): SessionStore {
    if (!this.sessionStore) {
      throw new Error('Session store not set on request. Is the session middleware registered?');
    }

    return this.sessionStore;
  }

  /**
   * Determine whether a session has been started for this request
   * Laravel: $request->hasSession()
   */
  hasSession(): boolean {
    return this.sessionStore !== undefined;
  }

  /**
   * Bind the session store to this request
   * Laravel: $request->setLaravelSession($session)
   */
  setSession(session: SessionStore): void {
    this.sessionStore = session;
  }

  /**
   * The bearer token from the `Authorization: Bearer ...` header
   * Laravel: $request->bearerToken()
   */
  bearerToken(): string | null {
    const authorization = this.header('authorization');

    if (!authorization || !authorization.startsWith('Bearer ')) {
      return null;
    }

    const token = authorization.slice('Bearer '.length).trim();

    return token === '' ? null : token;
  }

  /**
   * Bind the callback that resolves the authenticated user
   * Laravel: $request->setUserResolver($resolver)
   */
  setUserResolver(resolver: UserResolver): void {
    this.userResolver = resolver;
  }

  /**
   * Bind the callback that resolves the request's auth guard
   * Laravel: the request-side half of AuthServiceProvider's rebinding
   */
  setGuardResolver(resolver: GuardResolver): void {
    this.guardResolver = resolver;
  }

  /**
   * The authenticated user for a guard (the default when omitted), or null
   * while no auth layer has bound a resolver
   * Laravel: $request->user($guard)
   */
  async user<T extends Authenticatable = Authenticatable>(guard?: string): Promise<T | null> {
    if (!this.userResolver) {
      return null;
    }

    return (await this.userResolver(guard)) as T | null;
  }

  /**
   * The guard authenticating this request
   * Laravel: $request->user($guard) paired with $this->auth->guard($guard)
   */
  auth(guard?: string): StatefulGuard {
    if (!this.guardResolver) {
      throw new Error(
        'No auth guard bound to this request. Register the AuthServiceProvider and run the auth ' +
          'middleware, or call Auth.forRequest(request, response).'
      );
    }

    return this.guardResolver(guard);
  }

  /**
   * Determine whether the request's authenticated user can perform the
   * ability, checking it through the application's shared gate
   * Laravel: Illuminate\Http\Request::can() (Gate::forUser($this->user()))
   */
  async can(ability: string, args: any = []): Promise<boolean> {
    const user = await this.user();

    return resolveGate().forUser(user).allows(ability, args);
  }

  /**
   * Determine whether the request's authenticated user cannot perform the
   * ability
   * Laravel: Illuminate\Http\Request::cannot()
   */
  async cannot(ability: string, args: any = []): Promise<boolean> {
    const user = await this.user();

    return resolveGate().forUser(user).denies(ability, args);
  }

  /**
   * Authorize the request's user against the gate, returning the allow
   * Response or throwing AuthorizationException (rendered as a 403) when
   * the action is denied
   * Laravel: $request->user()->authorize($ability, $arguments)
   */
  async authorize(ability: string, args: any = []): Promise<Response> {
    const user = await this.user();

    return resolveGate().forUser(user).authorize(ability, args);
  }

  /**
   * Validate the request's input (text fields plus uploads) against the
   * given rules, throwing a ValidationException (rendered as a 422 by the
   * exception handler) when anything fails
   * Laravel: Illuminate\Http\Request::validate() / the controller's
   * ValidatesRequests trait
   *
   * @param {ValidationRules} rules
   * @param {Record<string, string>} messages custom validation messages
   * @param {Record<string, string>} attributes custom field names
   * @returns {Promise<Record<string, any>>} the validated data
   */
  async validate(
    rules: ValidationRules,
    messages: Record<string, string> = {},
    attributes: Record<string, string> = {}
  ): Promise<Record<string, any>> {
    const validator = new Validator(this.all(), rules, messages, attributes);

    if (!(await validator.validate())) {
      throw new ValidationException(validator);
    }

    return validator.validated();
  }

  /**
   * Get an input value from the request
   * Laravel: $request->input('name')
   */
  input(key: string, defaultValue?: any): any {
    return this.get(key, defaultValue);
  }

  /**
   * Get a value from query, body or uploaded files
   * Laravel: $request->get('name')
   */
  get(key: string, defaultValue?: any): any {
    if (this.query[key] !== undefined) {
      return this.query[key];
    }

    // parseQuery hands back a null-prototype bag, so instanceof is out;
    // any non-string body that can carry keys counts
    if (typeof this.body === 'object' && this.body !== null && this.body[key] !== undefined) {
      return this.body[key];
    }

    if (this.uploadedFiles[key] !== undefined) {
      return this.uploadedFiles[key];
    }

    return defaultValue;
  }

  /**
   * Get all inputs including uploaded files
   * Laravel: $request->all() (array_replace($this->input(), $this->allFiles()))
   */
  all(): Record<string, any> {
    const input = typeof this.body === 'string' ? {} : this.body;

    return { ...this.query, ...input, ...this.uploadedFiles };
  }

  /**
   * Get only specified inputs
   * Laravel: $request->only(['name', 'email'])
   */
  only(keys: string[]): Record<string, any> {
    const result: Record<string, any> = {};
    const all = this.all();

    for (const key of keys) {
      if (all[key] !== undefined) {
        result[key] = all[key];
      }
    }

    return result;
  }

  /**
   * Get all inputs except specified
   * Laravel: $request->except(['password'])
   */
  except(keys: string[]): Record<string, any> {
    const all = this.all();
    const result = { ...all };

    for (const key of keys) {
      delete result[key];
    }

    return result;
  }

  /**
   * Determine if the request contains a given input
   * Laravel: $request->has('name')
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Determine if the request contains a non-empty value
   * Laravel: $request->filled('name')
   */
  filled(key: string): boolean {
    const value = this.get(key);
    return value !== undefined && value !== null && value !== '';
  }

  /**
   * Get an uploaded file (or files) by input name, or the whole file bag
   * when called without a key
   * Laravel: $request->file('avatar') / $request->allFiles()
   */
  file(key?: string): Record<string, UploadedFile | UploadedFile[]> | UploadedFile | UploadedFile[] | null {
    if (key === undefined) {
      return this.uploadedFiles;
    }

    return this.uploadedFiles[key] ?? null;
  }

  /**
   * Determine whether the request carries an uploaded file for the input
   * Laravel: $request->hasFile('avatar')
   */
  hasFile(key: string): boolean {
    const file = this.uploadedFiles[key];

    if (file === undefined) {
      return false;
    }

    return Array.isArray(file) ? file.some((each) => each instanceof UploadedFile) : file instanceof UploadedFile;
  }

  /**
   * Every uploaded file on the request, keyed by input name
   * Laravel: $request->allFiles()
   */
  allFiles(): Record<string, UploadedFile | UploadedFile[]> {
    return { ...this.uploadedFiles };
  }

  /**
   * Replace the request's uploaded files, e.g. from a test or a proxying
   * middleware
   * Laravel: $request->setUploadedFiles($files)
   */
  setFiles(files: Record<string, UploadedFile | UploadedFile[]>): void {
    this.uploadedFiles = { ...files };
  }

  /**
   * Get the route handling the request, or one of its bound parameters
   * Laravel: $request->route(), $request->route('id')
   *
   * Called with a key it returns the resolved route parameter - the raw URL
   * segment before binding, the bound model or explicit binder result after.
   */
  route(): Route | undefined;
  route(key: string, defaultValue?: any): any;
  route(key?: string, defaultValue?: any): any {
    if (key === undefined) {
      return this.matchedRoute;
    }

    if (this.matchedRoute) {
      return this.matchedRoute.parameter(key, defaultValue);
    }

    return this.params[key] ?? defaultValue;
  }

  /**
   * Record the route that matched this request
   * Laravel: $request->setRouteResolver(fn () => $route)
   */
  setRoute(route: Route): void {
    this.matchedRoute = route;
  }

  /**
   * Get the route parameter
   * Laravel: $request->route('id') - kept as the explicit alias of route()
   */
  routeParam(key: string, defaultValue?: any): any {
    return this.route(key, defaultValue);
  }

  /**
   * Determine if the request is an AJAX request
   * Laravel: $request->ajax()
   */
  ajax(): boolean {
    return this.header('x-requested-with')?.toLowerCase() === 'xmlhttprequest';
  }

  /**
   * Determine if the request expects JSON
   * Laravel: $request->expectsJson() ($request->ajax() || $request->prefersJson())
   */
  expectsJson(): boolean {
    return this.ajax() || this.prefersJson();
  }

  /**
   * Determine if the request's Accept header prefers JSON
   * Laravel: $request->prefersJson()
   */
  prefersJson(): boolean {
    const accept = this.header('accept') || '';
    return accept.includes('application/json');
  }

  /**
   * Determine if the request accepts HTML responses
   * Laravel: $request->prefersHtml()
   *
   * Browsers list text/html explicitly; wildcard accepts are not treated as
   * HTML so tooling without an Accept header keeps the JSON rendering it got
   * before.
   */
  acceptsHtml(): boolean {
    const accept = this.header('accept') || '';
    return accept.includes('text/html') || accept.includes('application/xhtml+xml');
  }

  /**
   * Determine if the request is sending JSON
   * Laravel: $request->isJson()
   */
  isJson(): boolean {
    const contentType = this.header('content-type') || '';
    return contentType.includes('application/json');
  }

  /**
   * Get the request method
   * Laravel: $request->method()
   */
  getMethod(): string {
    return this.method;
  }

  /**
   * Determine if the request is a specific method
   * Laravel: $request->isMethod('post')
   */
  isMethod(method: string): boolean {
    return this.method.toLowerCase() === method.toLowerCase();
  }

  /**
   * Get the URL for the request
   * Laravel: $request->url()
   */
  getUrl(): string {
    return this.url;
  }

  /**
   * Get the path for the request
   * Laravel: $request->path()
   */
  getPath(): string {
    return this.path;
  }

  /**
   * Bind the proxy trust boundary that decides whether `X-Forwarded-*`
   * headers may be honoured for this request
   * Laravel/Symfony: $request->setTrustedProxies($proxies, $headerSet)
   */
  setTrustedProxies(trust: ProxyTrust): void {
    this.proxyTrust = trust;
  }

  /**
   * Determine whether the request's immediate source is a trusted proxy.
   * Only meaningful once the TrustProxies middleware has installed the
   * trust boundary; without it nothing counts as trusted.
   */
  fromTrustedProxy(): boolean {
    return this.proxyTrust !== undefined && this.proxyTrust.isTrustedProxy(this.raw.socket.remoteAddress);
  }

  /**
   * The comma-separated entries of a forwarded header, but only when the
   * source is a trusted proxy and the header is in the configured trust set;
   * untrusted forwarded input is silently dropped.
   */
  private forwarded(header: string): string[] {
    if (!this.fromTrustedProxy() || !this.proxyTrust?.trusts(header)) {
      return [];
    }

    const value = this.header(header);

    if (value === undefined) {
      return [];
    }

    const list = Array.isArray(value) ? value.join(',') : value;

    return list
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  /**
   * The IP address of the client behind (possible) proxies.
   *
   * With a trusted proxy, the `X-Forwarded-For` chain is walked right to
   * left - the closest hop is what the trusted proxy observed - and the
   * first untrusted address wins, so a chain a client spoofed cannot
   * masquerade as the caller. From untrusted sources the forwarded header
   * is ignored entirely and the socket address stands.
   * Laravel: $request->ip()
   */
  ip(): string | undefined {
    if (!this.fromTrustedProxy()) {
      return this.raw.socket.remoteAddress;
    }

    const chain = this.forwarded('x-forwarded-for');

    for (let i = chain.length - 1; i >= 0; i--) {
      if (!this.proxyTrust?.isTrustedProxy(chain[i])) {
        return chain[i];
      }
    }

    // Either no chain was sent, or every hop in it is a trusted proxy; the
    // chain's leftmost entry (or the socket) then describes the client.
    return chain[0] ?? this.raw.socket.remoteAddress;
  }

  /**
   * All addresses from the client through the proxy chain, client first
   * Laravel: $request->ips() (Symfony's getClientIps)
   *
   * Returns the trusted `X-Forwarded-For` chain when the request came from a
   * trusted proxy, and just the socket address otherwise - untrusted
   * forwarded headers carry no chain at all.
   */
  ips(): string[] {
    const chain = this.forwarded('x-forwarded-for');

    if (chain.length > 0) {
      return chain;
    }

    return this.raw.socket.remoteAddress ? [this.raw.socket.remoteAddress] : [];
  }

  /**
   * Determine whether the request arrived over HTTPS
   *
   * The trusted `X-Forwarded-Proto` chain answers first (TLS terminators
   * sit in front of plain HTTP apps); otherwise the socket's encryption
   * state decides. From untrusted sources nothing overrides the socket.
   * Laravel: $request->isSecure()
   */
  isSecure(): boolean {
    const [proto] = this.forwarded('x-forwarded-proto');

    if (proto !== undefined) {
      return proto.toLowerCase() === 'https';
    }

    // net.Socket types the property, but only a TLS socket carries it
    return (this.raw.socket as TLSSocket).encrypted === true;
  }

  /**
   * The request's scheme: https when the (trusted) forwarded proto or an
   * encrypted socket says so, http otherwise
   * Laravel: $request->scheme()
   */
  scheme(): string {
    return this.isSecure() ? 'https' : 'http';
  }

  /**
   * The host name the client addressed, without its port.
   *
   * The trusted `X-Forwarded-Host` wins over the `Host` header; from
   * untrusted sources only the `Host` header is considered.
   * Laravel: $request->getHttpHost() / $request->host()
   */
  host(): string | undefined {
    const [forwardedHost] = this.forwarded('x-forwarded-host');
    const value = forwardedHost ?? this.header('host');

    return value === undefined ? undefined : hostWithoutPort(value);
  }

  /**
   * The port the request was addressed on.
   *
   * Resolution order: the trusted `X-Forwarded-Port`, the port inside the
   * forwarded/host header value, the listening socket's port, and finally
   * the scheme's default port.
   * Laravel: $request->getPort()
   */
  port(): number {
    const forwardedPort = toPort(this.forwarded('x-forwarded-port')[0]);

    if (forwardedPort !== undefined) {
      return forwardedPort;
    }

    const headerPort = hostPort(this.header('host'));

    if (headerPort !== undefined) {
      return headerPort;
    }

    if (this.raw.socket.localPort) {
      return this.raw.socket.localPort;
    }

    return this.isSecure() ? 443 : 80;
  }
}

/**
 * Strip a trailing `:port` from a host value, keeping bracketed IPv6
 * literals intact: `[::1]:8080` -> `::1`, `app.test:8080` -> `app.test`
 */
function hostWithoutPort(value: string): string {
  if (value.startsWith('[')) {
    const bracket = value.indexOf(']');

    return bracket === -1 ? value : value.slice(1, bracket);
  }

  const colon = value.lastIndexOf(':');

  return colon !== -1 && !value.slice(colon + 1).includes(':') ? value.slice(0, colon) : value;
}

/**
 * The port carried by a host value like `app.test:8080`, or undefined when
 * it names no port
 */
function hostPort(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value.startsWith('[')) {
    const bracket = value.indexOf(']');

    return bracket === -1 ? undefined : toPort(value.slice(bracket + 1).replace(':', ''));
  }

  const colon = value.lastIndexOf(':');

  return colon === -1 || value.slice(colon + 1).includes(':') ? undefined : toPort(value.slice(colon + 1));
}

/**
 * Coerce a forwarded port value to a valid TCP port number
 */
function toPort(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const port = Number.parseInt(value, 10);

  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : undefined;
}

/**
 * Percent-decode a cookie component, keeping the raw value when it is not
 * a valid escape sequence
 */
function decodeCookieComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
