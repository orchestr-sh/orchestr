import { AsyncLocalStorage } from 'async_hooks';
import type { ViewFactory } from '@/View/ViewFactory';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { Application } from '@/Foundation/Application';
import { ValidationException } from '@/Foundation/Http/ValidationException';
import { View } from '@/View/View';
import { ModelNotFoundException } from './ModelNotFoundException';
import { Request } from './Request';
import { buildResourceRoutes, ResourceOptions } from './ResourceRegistrar';
import { Response } from './Response';
import { Route, HttpMethod, RouteAction, Middleware } from './Route';
import { RouteResolver, RouteBinder } from './RouteResolver';
import { RouteUrlParameters, UrlGenerator } from './UrlGenerator';

/**
 * Route group attributes
 */
export interface RouteGroupAttributes {
  prefix?: string;
  middleware?: Middleware | Middleware[];
  namespace?: string;
  /** Dot-joined prefix applied to every name given to routes in the group */
  name?: string;
  /** Host constraint every route in the group must satisfy */
  domain?: string;
  /** Apply scoped model binding to every route registered in the group */
  scopeBindings?: boolean;
}

/**
 * A resource controller: either the class (called as [Class, 'action']) or a
 * container-bound name used with the 'Controller@action' string syntax
 */
export type ResourceController = (new (...args: any[]) => any) | string;

/**
 * Per-dispatch context carried through the async call chain so concurrent
 * requests each observe their own current route
 */
interface RequestContext {
  route: Route | null;
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
  private urlGenerator: UrlGenerator;

  /**
   * Laravel resolves Route::current() from the request bound in the
   * container; in a shared Node process the request lives in an async-local
   * store instead, so concurrent dispatches never see each other's route.
   */
  private static readonly dispatchContext = new AsyncLocalStorage<RequestContext>();

  constructor(app: Application) {
    this.app = app;
    this.routeResolver = new RouteResolver(app);
    this.urlGenerator = new UrlGenerator(() => this.namedRoutes);
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
   * Register a global parameter constraint for every current and future
   * route that declares a parameter of that name
   * Laravel: Route::pattern('id', '[0-9]+')
   */
  pattern(name: string, regex: string): this {
    Route.pattern(name, regex);
    return this;
  }

  /**
   * Constrain the most recently registered route, mirroring the
   * scopeBindings() convention for calls that arrive after registration
   * Laravel: Route::where(...)
   */
  where(constraints: string | Record<string, string>, pattern?: string): this {
    const route = this.routes[this.routes.length - 1];

    if (!route) {
      throw new Error('No registered route for where() to constrain.');
    }

    route.where(constraints, pattern);
    return this;
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
   * Register a catch-all route that only runs when nothing else matched
   * Laravel: Route::fallback(action)
   */
  fallback(action: RouteAction): Route {
    const route = this.addRoute(['GET', 'HEAD'], '/:fallback', action);
    route.where('fallback', '.*');
    route.isFallback = true;
    this.name('fallback', route);

    return route;
  }

  /**
   * Register the seven conventional resource routes
   * Laravel: Route::resource('users', UserController::class)
   */
  resource(name: string, controller: ResourceController, options: ResourceOptions = {}): Route[] {
    return this.registerResource(name, controller, options, false);
  }

  /**
   * Register the API resource routes (create/edit omitted)
   * Laravel: Route::apiResource('users', UserController::class)
   */
  apiResource(name: string, controller: ResourceController, options: ResourceOptions = {}): Route[] {
    return this.registerResource(name, controller, options, true);
  }

  /**
   * Turn one route-definition table into registrations (DRY: the seven
   * actions are never hand-written twice)
   */
  private registerResource(
    name: string,
    controller: ResourceController,
    options: ResourceOptions,
    api: boolean
  ): Route[] {
    const routes: Route[] = [];

    for (const definition of buildResourceRoutes(name, options, api)) {
      const action =
        typeof controller === 'string'
          ? `${controller}@${definition.action}`
          : ([controller, definition.action] as [any, string]);

      const route = this.addRoute(definition.methods, definition.uri, action);
      this.name(definition.name, route);
      routes.push(route);
    }

    return routes;
  }

  /**
   * Register a route that renders a view
   * Laravel: Route::view('/welcome', 'welcome', ['name' => 'Taylor'])
   */
  view(uri: string, view: string, data: Record<string, any> = {}): Route {
    return this.get(uri, (_req: Request, res: Response) => {
      // With the view system registered the action returns a View the router
      // renders; otherwise fall back to the Response's built-in renderer.
      if (this.app.bound('view')) {
        return this.app.make<ViewFactory>('view').make(view, data);
      }

      return res.view(view, data);
    });
  }

  /**
   * Register a redirect route
   * Laravel: Route::redirect('/here', '/there', 301)
   */
  redirect(uri: string, destination: string, status: number = 302): Route {
    return this.get(uri, (_req: Request, res: Response) => {
      res.redirect(destination, status);
    });
  }

  /**
   * Generate the URL for a named route
   * Laravel: route('users.show', ['user' => 1])
   */
  url(name: string, parameters: RouteUrlParameters = {}): string {
    return this.urlGenerator.route(name, parameters);
  }

  /**
   * The route handling the request currently being dispatched, or null
   * Laravel: Route::current()
   */
  current(): Route | null {
    return Router.dispatchContext.getStore()?.route ?? null;
  }

  /**
   * The name of the route handling the current request
   * Laravel: Route::currentRouteName()
   */
  currentRouteName(): string | null {
    return this.current()?.name ?? null;
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
   * Register a route with a name, composing any group name prefixes
   * Laravel: Route::get('/users', action)->name('users.index')
   */
  name(name: string, route: Route): void {
    const fullName = route.namePrefix ? `${route.namePrefix}.${name}` : name;
    this.namedRoutes.set(fullName, route);
    route.setName(fullName);
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
    const namePrefixes: string[] = [];

    for (const group of this.groupStack) {
      if (group.middleware) {
        const middleware = Array.isArray(group.middleware) ? group.middleware : [group.middleware];
        route.addMiddleware(middleware);
      }

      if (group.scopeBindings) {
        route.scopeBindings();
      }

      if (group.domain) {
        route.domain = group.domain;
      }

      if (group.name) {
        namePrefixes.push(group.name.replace(/\.+$/, ''));
      }
    }

    if (namePrefixes.length > 0) {
      route.namePrefix = namePrefixes.join('.');
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
   *
   * Returns a per-request clone with its own parameter bag; fallback routes
   * are consulted only after every regular route has failed to match.
   */
  findRoute(method: string, path: string, host?: string): Route | null {
    const normalized = Route.normalizePath(path);
    const regular = this.matchIn(
      this.routes.filter((route) => !route.isFallback),
      method,
      normalized,
      host
    );

    if (regular) {
      return regular;
    }

    return this.matchIn(
      this.routes.filter((route) => route.isFallback),
      method,
      normalized,
      host
    );
  }

  /**
   * Search one route list for a method/path/domain match and prepare it for
   * this request
   */
  private matchIn(routes: Route[], method: string, path: string, host?: string): Route | null {
    for (const route of routes) {
      if (route.matches(method, path) && route.matchesDomain(host)) {
        return this.prepareRouteForRequest(route, path, host);
      }
    }

    return null;
  }

  /**
   * Clone the matched registration and bind path/domain parameters into the
   * copy so concurrent requests never share a parameter bag
   */
  private prepareRouteForRequest(route: Route, path: string, host?: string): Route {
    const instance = route.clone();
    const pathParameters = instance.bind(path);

    for (const [key, value] of Object.entries(route.bindDomainParameters(host))) {
      if (!(key in pathParameters)) {
        pathParameters[key] = value;
      }
    }

    return instance;
  }

  /**
   * Collect the methods registered for a path, ignoring the request method.
   * Fallback routes are excluded: they answer "anything" by design and must
   * not turn every unmatched path into a 405.
   */
  private allowedMethods(path: string, host?: string): string[] {
    const normalized = Route.normalizePath(path);
    const allowed = new Set<string>();

    for (const route of this.routes) {
      if (route.isFallback) {
        continue;
      }

      if (route.pathMatches(normalized) && route.matchesDomain(host)) {
        for (const method of route.methods) {
          allowed.add(method);
        }
      }
    }

    return [...allowed];
  }

  /**
   * Dispatch the request to a route
   */
  async dispatch(req: Request, res: Response): Promise<void> {
    const context: RequestContext = { route: null };

    return Router.dispatchContext.run(context, async () => {
      const host = req.header('host');
      const path = Route.normalizePath(req.path);
      const route = this.findRoute(req.method, path, host);

      if (!route) {
        this.respondMethodMismatch(req, res, path, host);
        return;
      }

      context.route = route;

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
    });
  }

  /**
   * Answer requests that found no route: 405 with an Allow header when the
   * path exists under other verbs, an Allow-bearing response for OPTIONS,
   * and a plain 404 otherwise
   */
  private respondMethodMismatch(req: Request, res: Response, path: string, host?: string): void {
    const allowed = this.allowedMethods(path, host);

    if (allowed.length === 0) {
      res.status(404).send('Not Found');
      return;
    }

    res.header('Allow', allowed.join(', '));

    if (req.method === 'OPTIONS') {
      res.status(204).send(undefined);
      return;
    }

    res.status(405).send('Method Not Allowed');
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
