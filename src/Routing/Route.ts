import { IncomingMessage, ServerResponse } from 'http';
import { Request } from './Request';
import { Response } from './Response';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
export type RouteAction = ((...args: any[]) => any) | string | [new (...args: any[]) => any, string];
export type Middleware = (req: Request, res: Response, next: () => void) => void | Promise<void>;

/**
 * Route - Represents a single route in the application
 * Laravel's Illuminate\Routing\Route
 */
export class Route {
  public uri: string;
  public methods: HttpMethod[];
  public action: RouteAction;
  public middleware: Middleware[] = [];
  public name?: string;
  /**
   * The bound parameters for the route. Raw string values from the URL until
   * route model binding runs; afterwards resolved bindings (models, explicit
   * binder results) replace their entries, matching Laravel's
   * `Route::parameters()` after `substituteBindings()`.
   */
  public parameters: Record<string, any> = {};
  /**
   * Whether child model bindings on this route are constrained by their parent
   * Laravel: Route::$scopedBindings
   */
  public scopedBindings: boolean = false;
  private compiled?: RegExp;
  private parameterNames: string[] = [];
  private optionalNames: Set<string> = new Set();

  constructor(methods: HttpMethod | HttpMethod[], uri: string, action: RouteAction) {
    this.methods = Array.isArray(methods) ? methods : [methods];
    this.uri = uri;
    this.action = action;
    this.compileRoute();
  }

  /**
   * Compile the route pattern into a regex
   */
  private compileRoute(): void {
    // Extract parameter names from the URI
    const paramPattern = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
    let match;

    while ((match = paramPattern.exec(this.uri)) !== null) {
      this.parameterNames.push(match[1]);
    }

    // Optional parameters (`:id?`) may legitimately be absent from a match
    const optionalPattern = /:([a-zA-Z_][a-zA-Z0-9_]*)\?/g;

    while ((match = optionalPattern.exec(this.uri)) !== null) {
      this.optionalNames.add(match[1]);
    }

    // Convert Laravel-style parameters to regex
    // :id -> ([^/]+)
    // :id? -> ([^/]*)
    const pattern = this.uri
      .replace(/\//g, '\\/')
      .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)\?/g, '([^/]*)')
      .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '([^/]+)');

    this.compiled = new RegExp(`^${pattern}$`);
  }

  /**
   * Determine if the route matches the given request
   */
  matches(method: string, path: string): boolean {
    if (!this.methods.includes(method as HttpMethod)) {
      return false;
    }

    return this.compiled?.test(path) || false;
  }

  /**
   * Bind the route parameters from the path
   *
   * An optional segment (`:id?`) that matched nothing is left out entirely,
   * the way Laravel's `Route::parameters()` omits missing optional values.
   */
  bind(path: string): void {
    const match = this.compiled?.exec(path);

    if (match) {
      this.parameters = {};
      this.parameterNames.forEach((name, index) => {
        const value = match[index + 1];

        if (value === '' && this.optionalNames.has(name)) {
          return;
        }

        this.parameters[name] = value;
      });
    }
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
