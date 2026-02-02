import { Application } from '../Foundation/Application';
import { Route, HttpMethod, RouteAction, Middleware } from './Route';
import { Request } from './Request';
import { Response } from './Response';

/**
 * Route group attributes
 */
export interface RouteGroupAttributes {
  prefix?: string;
  middleware?: Middleware | Middleware[];
  namespace?: string;
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

  constructor(app: Application) {
    this.app = app;
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
    }
  }

  /**
   * Get the prefix from the last group on the stack
   */
  private prefix(uri: string): string {
    const prefix = this.groupStack
      .filter(group => group.prefix)
      .map(group => group.prefix)
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

    // Store the route on the request
    req.route = route;
    req.params = route.getParameters();

    try {
      // Run through middleware pipeline
      await this.runMiddleware(route, req, res, async () => {
        // Execute the route action
        await this.runRoute(route, req, res);
      });
    } catch (error) {
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
      result = await this.callControllerTuple(action, req, res);
    } else if (typeof action === 'string') {
      // Controller@method string
      result = await this.callControllerAction(action, req, res);
    }

    // If the handler returned a value and response wasn't sent, send it
    if (result !== undefined && !res.finished) {
      res.send(result);
    }
  }

  /**
   * Call a controller action using tuple format
   * Laravel-style: [UserController, 'index']
   */
  private async callControllerTuple(
    action: [new (...args: any[]) => any, string],
    req: Request,
    res: Response
  ): Promise<any> {
    const [ControllerClass, methodName] = action;

    // Resolve the controller from the container
    const controller = this.app.make(ControllerClass);

    // Verify the method exists on the controller
    if (typeof (controller as any)[methodName] !== 'function') {
      throw new Error(
        `Method [${methodName}] does not exist on controller [${ControllerClass.name}].`
      );
    }

    // Call the controller method
    return await (controller as any)[methodName](req, res);
  }

  /**
   * Call a controller action
   * Laravel: 'UserController@index'
   */
  private async callControllerAction(action: string, req: Request, res: Response): Promise<any> {
    const [controllerName, methodName] = action.split('@');

    // This would normally resolve the controller from the container
    // For now, throw an error indicating controllers need to be registered
    throw new Error(
      `Controller action [${action}] not yet implemented. ` +
      `Use closures or register controllers in the container.`
    );
  }

  /**
   * Get all registered routes
   */
  getRoutes(): Route[] {
    return this.routes;
  }
}
