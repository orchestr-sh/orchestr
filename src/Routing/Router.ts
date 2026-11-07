import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { Application } from '@/Foundation/Application';
import { ValidationException } from '@/Foundation/Http/ValidationException';
import { View } from '@/View/View';
import { ModelNotFoundException } from './ModelNotFoundException';
import { Request } from './Request';
import { Response } from './Response';
import { Route, HttpMethod, RouteAction, Middleware } from './Route';
import { RouteResolver, RouteBinder } from './RouteResolver';

/**
 * Route group attributes
 */
export interface RouteGroupAttributes {
  prefix?: string;
  middleware?: Middleware | Middleware[];
  namespace?: string;
  /** Apply scoped model binding to every route registered in the group */
  scopeBindings?: boolean;
}

/**
 * Router - Laravel's routing system
 * Illuminate\Routing\Router
 */
export class Router {
  private app: Application;
  private routes: Route[] = [];
  private groupStack: RouteGroupAttributes[] = [];
  private namedRoutes: Map<string, Route> = new Map();
  private routeResolver: RouteResolver;

  constructor(app: Application) {
    this.app = app;
    this.routeResolver = new RouteResolver(app);
  }

  /**
   * Get the route resolver shared by binding and controller reflection
   */
  getRouteResolver(): RouteResolver {
    return this.routeResolver;
  }

  /**
   * Register an explicit binding for a route parameter
   * Laravel: Route::bind('user', fn ($value) => ...)
   */
  bind(key: string, callback: RouteBinder): void {
    this.routeResolver.bind(key, callback);
  }

  /**
   * Register an explicit model binding for a route parameter
   * Laravel: Route::model('user', User::class)
   */
  model(key: string, ModelClass: typeof Ensemble): void {
    this.routeResolver.model(key, ModelClass);
  }

  /**
   * Enable scoped bindings for the current group or the last registered route
   * Laravel: Route::scopeBindings()
   */
  scopeBindings(): this {
    if (this.hasGroupStack()) {
      this.groupStack[this.groupStack.length - 1].scopeBindings = true;
    } else if (this.routes.length > 0) {
      this.routes[this.routes.length - 1].scopeBindings();
    }

    return this;
  }

  /**
   * Register a new GET route
   * Laravel: Route::get('/path', action)
   */
  get(uri: string, action: RouteAction): Route {
    return this.addRoute(['GET', 'HEAD'], uri, action);
  }

  /**
   * Register a new POST route
   * Laravel: Route::post('/path', action)
   */
  post(uri: string, action: RouteAction): Route {
    return this.addRoute(['POST'], uri, action);
  }

  /**
   * Register a new PUT route
   * Laravel: Route::put('/path', action)
   */
  put(uri: string, action: RouteAction): Route {
    return this.addRoute(['PUT'], uri, action);
  }

  /**
   * Register a new PATCH route
   * Laravel: Route::patch('/path', action)
   */
  patch(uri: string, action: RouteAction): Route {
    return this.addRoute(['PATCH'], uri, action);
  }

  /**
   * Register a new DELETE route
   * Laravel: Route::delete('/path', action)
   */
  delete(uri: string, action: RouteAction): Route {
    return this.addRoute(['DELETE'], uri, action);
  }

  /**
   * Register a new route responding to all verbs
   * Laravel: Route::any('/path', action)
   */
  any(uri: string, action: RouteAction): Route {
    return this.addRoute(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'], uri, action);
  }

  /**
   * Register a new route with the given methods
   * Laravel: Route::match(['get', 'post'], '/path', action)
   */
  match(methods: HttpMethod[], uri: string, action: RouteAction): Route {
    return this.addRoute(methods, uri, action);
  }

  /**
   * Add a route to the collection
   */
  private addRoute(methods: HttpMethod[], uri: string, action: RouteAction): Route {
    const route = new Route(methods, this.prefix(uri), action);

    // Apply group middleware
    if (this.hasGroupStack()) {
      this.applyGroupAttributes(route);
    }

    this.routes.push(route);

    return route;
  }

  /**
   * Create a route group with shared attributes
   * Laravel: Route::group(['middleware' => 'auth'], function() {...})
   */
  group(attributes: RouteGroupAttributes, callback: () => void): void {
    this.groupStack.push(attributes);
    callback();
    this.groupStack.pop();
  }

  /**
   * Register a route with a name
   * Laravel: Route::get('/users', action)->name('users.index')
   */
  name(name: string, route: Route): void {
    this.namedRoutes.set(name, route);
    route.setName(name);
  }

  /**
   * Get a route by name
   */
  getByName(name: string): Route | undefined {
    return this.namedRoutes.get(name);
  }

  /**
   * Apply group attributes to a route
   */
  private applyGroupAttributes(route: Route): void {
    for (const group of this.groupStack) {
      if (group.middleware) {
        const middleware = Array.isArray(group.middleware) ? group.middleware : [group.middleware];
        route.addMiddleware(middleware);
      }

      if (group.scopeBindings) {
        route.scopeBindings();
      }
    }
  }

  /**
   * Get the prefix from the last group on the stack
   */
  private prefix(uri: string): string {
    const prefix = this.groupStack
      .filter((group) => group.prefix)
      .map((group) => group.prefix)
      .join('/');

    return prefix ? `/${prefix}/${uri}`.replace(/\/+/g, '/') : uri;
  }

  /**
   * Determine if the router currently has a group stack
   */
  private hasGroupStack(): boolean {
    return this.groupStack.length > 0;
  }

  /**
   * Find the route matching a given request
   */
  findRoute(method: string, path: string): Route | null {
    for (const route of this.routes) {
      if (route.matches(method, path)) {
        route.bind(path);
        return route;
      }
    }

    return null;
  }

  /**
   * Dispatch the request to a route
   */
  async dispatch(req: Request, res: Response): Promise<void> {
    const route = this.findRoute(req.method, req.path);

    if (!route) {
      res.status(404).send('Not Found');
      return;
    }

    try {
      // Resolve route bindings: Route::bind / Route::model / implicit models
      await this.routeResolver.substituteBindings(route);

      // Store the route on the request
      req.setRoute(route);
      req.params = route.getParameters();

      // Run through middleware pipeline
      await this.runMiddleware(route, req, res, async () => {
        // Execute the route action
        await this.runRoute(route, req, res);
      });
    } catch (error) {
      if (error instanceof ModelNotFoundException) {
        res.status(404).send('Not Found');
        return;
      }

      res.status(500).send(error instanceof Error ? error.message : 'Internal Server Error');
    }
  }

  /**
   * Run the route middleware pipeline
   */
  private async runMiddleware(
    route: Route,
    req: Request,
    res: Response,
    finalHandler: () => Promise<void>
  ): Promise<void> {
    const middleware = [...route.middleware];

    const runNext = async (index: number): Promise<void> => {
      if (index >= middleware.length) {
        await finalHandler();
        return;
      }

      const currentMiddleware = middleware[index];
      await currentMiddleware(req, res, () => runNext(index + 1));
    };

    await runNext(0);
  }

  /**
   * Run the route action
   */
  private async runRoute(route: Route, req: Request, res: Response): Promise<void> {
    const action = route.action;

    let result: any;

    if (typeof action === 'function') {
      // Direct closure
      result = await action(req, res);
    } else if (Array.isArray(action)) {
      // Controller tuple: [ControllerClass, 'method']
      result = await this.callControllerTuple(action, route, req, res);
    } else if (typeof action === 'string') {
      // Controller@method string
      result = await this.callControllerAction(action, route, req, res);
    }

    // If the handler returned a value and response wasn't sent, send it
    if (result !== undefined && !res.finished) {
      if (result instanceof View) {
        const html = await result.render();
        res.header('Content-Type', 'text/html');
        res.send(html);
      } else {
        res.send(result);
      }
    }
  }

  /**
   * Call a controller action using tuple format
   * Laravel-style: [UserController, 'index']
   */
  private async callControllerTuple(
    action: [new (...args: any[]) => any, string],
    route: Route,
    req: Request,
    res: Response
  ): Promise<any> {
    const [ControllerClass, methodName] = action;

    // Resolve the controller from the container
    const controller = this.app.make(ControllerClass);

    // Verify the method exists on the controller
    if (typeof (controller as any)[methodName] !== 'function') {
      throw new Error(`Method [${methodName}] does not exist on controller [${ControllerClass.name}].`);
    }

    return this.callController(controller, ControllerClass.prototype, methodName, route, req, res);
  }

  /**
   * Call a controller action given as a 'Controller@method' string,
   * resolving the controller from the container.
   * Laravel: 'UserController@index'
   */
  private async callControllerAction(action: string, route: Route, req: Request, res: Response): Promise<any> {
    const separator = action.lastIndexOf('@');
    const controllerName = separator === -1 ? action : action.slice(0, separator);
    const methodName = separator === -1 ? '' : action.slice(separator + 1);

    if (!methodName) {
      throw new Error(`Malformed controller action [${action}]. Expected the 'Controller@method' format.`);
    }

    // Resolve the controller from the container
    let controller: any;
    try {
      controller = this.app.make<any>(controllerName);
    } catch (error) {
      throw new Error(
        `Controller [${controllerName}] is not resolvable from the container. Bind it, or use the ` +
          `[ControllerClass, 'method'] tuple syntax. Original error: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (typeof controller?.[methodName] !== 'function') {
      throw new Error(`Method [${methodName}] does not exist on controller [${controllerName}].`);
    }

    return this.callController(controller, Object.getPrototypeOf(controller), methodName, route, req, res);
  }

  /**
   * Resolve an action's dependencies through the shared route resolver and
   * invoke it.
   *
   * FormRequest validation failures keep their historical HTTP behaviour:
   * a failed validation answers 422 with the error bag, a denial answers 403.
   */
  private async callController(
    controller: any,
    prototype: any,
    methodName: string,
    route: Route,
    req: Request,
    res: Response
  ): Promise<any> {
    const reflection = this.routeResolver.reflectMethod(prototype, methodName);

    let args: any[];
    try {
      args = await this.routeResolver.resolveArguments(reflection, route.getParameters(), req, res);
    } catch (error) {
      // If validation failed, send error response
      if (error instanceof ValidationException) {
        res.status(422).json({
          message: 'The given data was invalid.',
          errors: error.errors(),
        });
        return;
      }

      // If authorization failed, send error response
      if (error instanceof Error && error.message === 'This action is unauthorized.') {
        res.status(403).json({
          message: 'This action is unauthorized.',
        });
        return;
      }

      throw error;
    }

    return await controller[methodName](...args);
  }

  /**
   * Get all registered routes
   */
  getRoutes(): Route[] {
    return this.routes;
  }
}
