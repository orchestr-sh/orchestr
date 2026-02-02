import { IncomingMessage, ServerResponse } from 'http';
import { Request } from './Request';
import { Response } from './Response';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
export type RouteAction = Function | string | [new (...args: any[]) => any, string];
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
  public parameters: Record<string, string> = {};
  private compiled?: RegExp;
  private parameterNames: string[] = [];

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

    // Convert Laravel-style parameters to regex
    // :id -> ([^/]+)
    // :id? -> ([^/]*)
    let pattern = this.uri
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
   */
  bind(path: string): void {
    const match = this.compiled?.exec(path);

    if (match) {
      this.parameters = {};
      this.parameterNames.forEach((name, index) => {
        this.parameters[name] = match[index + 1];
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
   * Get the route parameters
   */
  getParameters(): Record<string, string> {
    return this.parameters;
  }

  /**
   * Get a specific parameter value
   */
  parameter(name: string, defaultValue?: string): string | undefined {
    return this.parameters[name] ?? defaultValue;
  }
}
