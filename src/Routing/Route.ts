import { Request } from './Request';
import { Response } from './Response';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
export type RouteAction = ((...args: any[]) => any) | string | [new (...args: any[]) => any, string];
export type Middleware = (req: Request, res: Response, next: () => void) => void | Promise<void>;

/**
 * Escape a literal string for safe embedding inside a RegExp
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PARAMETER_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Route - Represents a single route in the application
 * Laravel's Illuminate\Routing\Route
 *
 * The registered route is shared across requests, so dispatch never binds
 * parameters on it directly - `clone()` produces a per-request copy with its
 * own `parameters` bag, keeping concurrent dispatches isolated.
 */
export class Route {
  public uri: string;
  public methods: HttpMethod[];
  public action: RouteAction;
  public middleware: Middleware[] = [];
  public name?: string;
  /**
   * The bound parameters for this route instance. Raw string values from the
   * URL until route model binding runs; afterwards resolved bindings (models,
   * explicit binder results) replace their entries, matching Laravel's
   * `Route::parameters()` after `substituteBindings()`.
   */
  public parameters: Record<string, any> = {};
  /**
   * Whether child model bindings on this route are constrained by their parent
   * Laravel: Route::$scopedBindings
   */
  public scopedBindings: boolean = false;
  /**
   * Per-route parameter constraints, keyed by parameter name
   * Laravel: Route::where() / Route::$wheres
   */
  public wheres: Record<string, string> = {};
  /**
   * Host constraint inherited from a group's `domain` attribute
   * Laravel: Route::domain()
   */
  public domain?: string;
  /**
   * Fallback routes only run after every regular route failed to match
   * Laravel: Route::fallback()
   */
  public isFallback: boolean = false;
  /**
   * Dot-joined name prefixes contributed by enclosing route groups, applied
   * when the route receives its final name
   */
  public namePrefix?: string;

  private parameterNames: string[] = [];
  private optionalNames: Set<string> = new Set();
  private compiled?: RegExp;
  private compiledAtVersion: number = -1;
  private domainCompiled?: RegExp;
  private domainParameterNames: string[] = [];

  /**
   * Global per-name parameter constraints; Laravel: Route::pattern() backed
   * by Illuminate\Routing\Route::$patterns
   */
  private static patterns: Map<string, string> = new Map();
  private static patternVersion: number = 0;

  constructor(methods: HttpMethod | HttpMethod[], uri: string, action: RouteAction) {
    this.methods = Array.isArray(methods) ? methods : [methods];
    this.uri = Route.normalizePath(uri);
    this.action = action;
    this.compileRoute();
  }

  /**
   * Normalize a URI or request path: leading slash, collapsed duplicate
   * slashes, trailing slash removed (root '/' excepted)
   */
  static normalizePath(path: string): string {
    let normalized = path.startsWith('/') ? path : `/${path}`;
    normalized = normalized.replace(/\/{2,}/g, '/');

    if (normalized.length > 1) {
      normalized = normalized.replace(/\/+$/, '');
    }

    return normalized;
  }

  /**
   * Register a global constraint applied to every route parameter of that
   * name, current and future
   * Laravel: Route::pattern('id', '[0-9]+')
   */
  static pattern(name: string, regex: string): void {
    Route.assertValidParameterName(name);
    Route.assertValidConstraint(name, regex);
    Route.patterns.set(name, regex);
    Route.patternVersion += 1;
  }

  /**
   * Look up a global constraint
   */
  static getPattern(name: string): string | undefined {
    return Route.patterns.get(name);
  }

  /**
   * Forget every global constraint. The static store outlives individual
   * applications, so tests and tools use this to reset it.
   */
  static flushPatterns(): void {
    Route.patterns.clear();
    Route.patternVersion += 1;
  }

  /**
   * Determine whether a parameter constraint compiles as a regex
   */
  private static assertValidConstraint(name: string, regex: string): void {
    try {
      new RegExp(`^(?:${regex})$`);
    } catch {
      throw new Error(`Invalid regular expression constraint [${regex}] for parameter [${name}].`);
    }
  }

  private static assertValidParameterName(name: string): void {
    if (!PARAMETER_NAME.test(name)) {
      throw new Error(`Invalid route parameter name [${name}].`);
    }
  }

  /**
   * Compile the route pattern into a regex, deriving the parameter list and
   * the constraints from one pass so they can never drift apart
   */
  private compileRoute(): void {
    this.parameterNames = [];
    this.optionalNames = new Set();

    let pattern = '';

    for (const segment of this.uri.split('/').slice(1)) {
      pattern += this.compileSegment(segment);
    }

    this.compiled = new RegExp(`^${pattern}$`);
    this.compiledAtVersion = Route.patternVersion;
  }

  /**
   * Compile one path segment into its regex fragment (including its leading
   * slash). Whole-segment `:name` / `:name?` tokens become capture groups;
   * `:name` tokens embedded in mixed segments compile inline as before.
   */
  private compileSegment(segment: string): string {
    const whole = /^:([a-zA-Z_][a-zA-Z0-9_]*)(\?)?$/.exec(segment);

    if (whole) {
      const [, name, mark] = whole;
      this.parameterNames.push(name);

      if (mark) {
        this.optionalNames.add(name);
      }

      const group = `((?:${this.constraintFor(name)}))`;
      return mark ? `(?:/${group})?` : `/${group}`;
    }

    let fragment = '';
    let rest = segment;

    while (rest.length > 0) {
      const match = /:([a-zA-Z_][a-zA-Z0-9_]*)/.exec(rest);

      if (!match) {
        fragment += escapeRegExp(rest);
        break;
      }

      fragment += escapeRegExp(rest.slice(0, match.index));
      this.parameterNames.push(match[1]);
      fragment += `((?:${this.constraintFor(match[1])}))`;
      rest = rest.slice(match.index + match[0].length);
    }

    return `/${fragment}`;
  }

  /**
   * Resolve the regex constraint for a parameter: the route's own `where`
   * wins over the global `pattern`, which wins over "any one segment"
   */
  private constraintFor(name: string): string {
    return this.wheres[name] ?? Route.patterns.get(name) ?? '[^/]+';
  }

  /**
   * Recompile lazily so constraints registered through Route.pattern() after
   * construction still take effect
   */
  private ensureCompiled(): void {
    if (!this.compiled || this.compiledAtVersion !== Route.patternVersion) {
      this.compileRoute();
    }
  }

  /**
   * Constrain a route parameter to a regex, validated at registration time
   * Laravel: Route::get(...)->where('id', '[0-9]+') and ->where([...])
   */
  where(constraints: string | Record<string, string>, pattern?: string): this {
    const entries: Array<[string, string]> =
      typeof constraints === 'string' ? [[constraints, pattern ?? '']] : Object.entries(constraints);

    for (const [name, regex] of entries) {
      if (!this.parameterNames.includes(name)) {
        throw new Error(`Route [${this.methods.join('|')} ${this.uri}] does not have a parameter named [${name}].`);
      }

      if (regex === '') {
        throw new Error(`A constraint pattern is required for parameter [${name}].`);
      }

      Route.assertValidConstraint(name, regex);
      this.wheres[name] = regex;
    }

    this.compileRoute();
    return this;
  }

  /**
   * Determine whether the URI declares a parameter with this name
   */
  hasParameter(name: string): boolean {
    return this.parameterNames.includes(name);
  }

  /**
   * The parameter names in URI (and therefore capture-group) order
   */
  getParameterNames(): string[] {
    this.ensureCompiled();
    return [...this.parameterNames];
  }

  /**
   * Determine whether a parameter was declared optional (`:name?`)
   */
  isOptionalParameter(name: string): boolean {
    this.ensureCompiled();
    return this.optionalNames.has(name);
  }

  /**
   * Determine if the route matches the given request
   */
  matches(method: string, path: string): boolean {
    if (!this.methods.includes(method as HttpMethod)) {
      return false;
    }

    return this.pathMatches(path);
  }

  /**
   * Determine whether the path matches this route's URI regardless of method
   * (used for 405 / Allow handling)
   */
  pathMatches(path: string): boolean {
    this.ensureCompiled();
    return this.compiled?.test(Route.normalizePath(path)) ?? false;
  }

  /**
   * Determine whether the request host satisfies the route's domain
   * constraint. Routes without a domain always match.
   */
  matchesDomain(host?: string): boolean {
    if (!this.domain) {
      return true;
    }

    if (!host) {
      return false;
    }

    return this.domainRegExp().test(Route.normalizeHost(host));
  }

  /**
   * Strip scheme artifacts and port from a Host header value
   */
  static normalizeHost(host: string): string {
    return host.toLowerCase().replace(/:\d+$/, '');
  }

  private domainRegExp(): RegExp {
    if (!this.domainCompiled) {
      this.domainParameterNames = [];

      const compiled = (this.domain ?? '')
        .split('.')
        .map((label) => {
          const match = /^:([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(label);

          if (!match) {
            // Host headers are compared case-insensitively
            return escapeRegExp(label.toLowerCase());
          }

          this.domainParameterNames.push(match[1]);
          return '([^./]+)';
        })
        .join('\\.');

      this.domainCompiled = new RegExp(`^${compiled}$`);
    }

    return this.domainCompiled;
  }

  /**
   * Capture the domain-constraint parameters for a host. Pure: returns a new
   * bag instead of touching `parameters`.
   */
  bindDomainParameters(host?: string): Record<string, any> {
    const values: Record<string, any> = {};

    if (!this.domain || !host) {
      return values;
    }

    const match = this.domainRegExp().exec(Route.normalizeHost(host));

    if (match) {
      this.domainParameterNames.forEach((name, index) => {
        values[name] = Route.decode(match[index + 1]);
      });
    }

    return values;
  }

  /**
   * Bind the route parameters from the path
   *
   * An optional segment (`:id?`) that matched nothing is left out entirely,
   * the way Laravel's `Route::parameters()` omits missing optional values.
   * Values are URL-decoded. Returns the bound bag.
   */
  bind(path: string): Record<string, any> {
    this.ensureCompiled();
    const match = this.compiled?.exec(Route.normalizePath(path));

    this.parameters = {};

    if (match) {
      this.parameterNames.forEach((name, index) => {
        const value = match[index + 1];

        if (value === undefined || (value === '' && this.optionalNames.has(name))) {
          return;
        }

        this.parameters[name] = Route.decode(value);
      });
    }

    return this.parameters;
  }

  /**
   * Percent-decode a captured value, tolerating malformed sequences
   */
  private static decode(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  /**
   * Copy the route for a single request so parameter binding and model
   * substitution never mutate the shared registration
   */
  clone(): Route {
    const route = new Route(this.methods, this.uri, this.action);
    route.middleware = [...this.middleware];
    route.name = this.name;
    route.wheres = { ...this.wheres };
    route.domain = this.domain;
    route.scopedBindings = this.scopedBindings;
    route.isFallback = this.isFallback;
    route.namePrefix = this.namePrefix;
    route.compileRoute();
    return route;
  }

  /**
   * Add middleware to the route
   * Laravel: Route::middleware('auth')
   */
  addMiddleware(middleware: Middleware | Middleware[]): this {
    const middlewares = Array.isArray(middleware) ? middleware : [middleware];
    this.middleware.push(...middlewares);
    return this;
  }

  /**
   * Set the route name
   * Laravel: Route::name('users.index')
   */
  setName(name: string): this {
    this.name = name;
    return this;
  }

  /**
   * Enable scoped model binding for this route
   * Laravel: Route::get('/users/{user}/posts/{post}', ...)->scopeBindings()
   *
   * Child bindings resolved after a parent model binding are constrained by
   * the parent, so a sibling row that exists but does not belong to the
   * parent yields a ModelNotFoundException.
   */
  scopeBindings(): this {
    this.scopedBindings = true;
    return this;
  }

  /**
   * Get the route parameters
   */
  getParameters(): Record<string, any> {
    return this.parameters;
  }

  /**
   * Get a specific parameter value
   */
  parameter(name: string, defaultValue?: any): any {
    return this.parameters[name] ?? defaultValue;
  }
}
