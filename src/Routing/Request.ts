import { IncomingMessage } from 'http';
import { parse as parseQuery } from 'querystring';
import { parse as parseUrl } from 'url';
import type { Store as SessionStore } from '@/Session/Contracts/Store';
import { Route } from './Route';

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

  private bodyParsed: boolean = false;

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
   */
  async parseBody(): Promise<void> {
    if (this.bodyParsed) {
      return;
    }

    return new Promise((resolve, reject) => {
      let data = '';

      this.raw.on('data', (chunk) => {
        data += chunk.toString();
      });

      this.raw.on('end', () => {
        try {
          const contentType = this.header('content-type') || '';

          if (contentType.includes('application/json')) {
            this.body = data ? JSON.parse(data) : {};
          } else if (contentType.includes('application/x-www-form-urlencoded')) {
            this.body = parseQuery(data);
          } else {
            this.body = data;
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
   * Get an input value from the request
   * Laravel: $request->input('name')
   */
  input(key: string, defaultValue?: any): any {
    return this.get(key, defaultValue);
  }

  /**
   * Get a value from query or body
   * Laravel: $request->get('name')
   */
  get(key: string, defaultValue?: any): any {
    if (this.query[key] !== undefined) {
      return this.query[key];
    }

    if (this.body[key] !== undefined) {
      return this.body[key];
    }

    return defaultValue;
  }

  /**
   * Get all inputs
   * Laravel: $request->all()
   */
  all(): Record<string, any> {
    return { ...this.query, ...this.body };
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
   * Get the IP address of the request
   * Laravel: $request->ip()
   */
  ip(): string | undefined {
    const forwarded = this.header('x-forwarded-for');
    if (forwarded) {
      return Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    }

    return this.raw.socket.remoteAddress;
  }
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
