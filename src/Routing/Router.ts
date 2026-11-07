import { AsyncLocalStorage } from 'async_hooks';
import type { Handler } from '@/Foundation/Exceptions';
import type { ViewFactory } from '@/View/ViewFactory';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { Application } from '@/Foundation/Application';
import { NotFoundHttpException, resolveExceptionHandler } from '@/Foundation/Exceptions';
import { View } from '@/View/View';
import type { Middleware, MiddlewareArgument } from './Pipeline';
import { Pipeline } from './Pipeline';
import { Request } from './Request';
import { buildResourceRoutes, ResourceOptions } from './ResourceRegistrar';
import { Response } from './Response';
import { RedirectResponse } from './Responses/RedirectResponse';
import { ResponseObject } from './Responses/ResponseObject';
import { Route, HttpMethod, RouteAction } from './Route';
import { RouteResolver, RouteBinder } from './RouteResolver';
import { RouteUrlParameters, UrlGenerator } from './UrlGenerator';

/**
 * Route group attributes
 */
export interface RouteGroupAttributes {
  prefix?: string;
  middleware?: MiddlewareArgument | MiddlewareArgument[];
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
   * Named middleware standing in for the function at dispatch time
   * Laravel: Router::$middlewareAliases
   */
  private middlewareAliases: Map<string, Middleware> = new Map();
  /**
   * Named middleware groups expanded in declared order
   * Laravel: Router::$middlewareGroups
   */
  private middlewareGroups: Map<string, MiddlewareArgument[]> = new Map();
  /**
   * Relative ordering applied to gathered middleware
   * Laravel: Router::$middlewarePriority
   */
  private middlewarePriorityList: MiddlewareArgument[] = [];

  /**
   * The application's shared exception handler; the Kernel resolves the
   * same instance from the container, so both entry points answer errors
   * identically
   */
  private exceptionHandler?: Handler;

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
   * The shared exception handler dispatch failures are rendered with
   * Laravel: Router resolves the ExceptionHandler contract from the container
   */
  getExceptionHandler(): Handler {
    this.exceptionHandler ??= resolveExceptionHandler(this.app);
    return this.exceptionHandler;
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
    return this.get(uri, () => {
      // With the view system registered the action returns a View the router
      // renders; otherwise respond with the built-in fallback page
      if (this.app.bound('view')) {
        return this.app.make<ViewFactory>('view').make(view, data);
      }

      return new ResponseObject(
        `<html><body><h1>View: ${view}</h1><pre>${JSON.stringify(data, null, 2)}</pre></body></html>`,
        200,
        { 'Content-Type': 'text/html' }
      );
    });
  }

  /**
   * Register a redirect route
   * Laravel: Route::redirect('/here', '/there', 301)
   */
  redirect(uri: string, destination: string, status: number = 302): Route {
    return this.get(uri, () => new RedirectResponse(destination, status));
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
        route.middleware(middleware);
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
   * Register a named middleware alias
   * Laravel: Router::aliasMiddleware()
   */
  aliasMiddleware(name: string, middleware: Middleware): this {
    this.middlewareAliases.set(name, middleware);
    return this;
  }

  /**
   * Get all registered middleware aliases
   * Laravel: Router::getMiddleware()
   */
  getMiddleware(): Record<string, Middleware> {
    return Object.fromEntries(this.middlewareAliases);
  }

  /**
   * Register a middleware group: a named list of middleware that expands in
   * declared order wherever the group name is referenced
   * Laravel: Router::middlewareGroup()
   */
  middlewareGroup(name: string, middleware: MiddlewareArgument[]): this {
    this.middlewareGroups.set(name, [...middleware]);
    return this;
  }

  /**
   * Get all registered middleware groups
   * Laravel: Router::getMiddlewareGroups()
   */
  getMiddlewareGroups(): Record<string, MiddlewareArgument[]> {
    return Object.fromEntries(this.middlewareGroups);
  }

  /**
   * Add middleware to the start of a group, creating it when missing
   * Laravel: Router::prependMiddlewareToGroup()
   */
  prependMiddlewareToGroup(name: string, ...middleware: MiddlewareArgument[]): this {
    this.middlewareGroups.set(name, [...middleware, ...(this.middlewareGroups.get(name) ?? [])]);
    return this;
  }

  /**
   * Add middleware to the end of a group, creating it when missing
   * Laravel: Router::appendMiddlewareToGroup()
   */
  appendMiddlewareToGroup(name: string, ...middleware: MiddlewareArgument[]): this {
    this.middlewareGroups.set(name, [...(this.middlewareGroups.get(name) ?? []), ...middleware]);
    return this;
  }

  /**
   * Set the relative priority ordering for gathered middleware
   * Laravel: Router::middlewarePriority()
   */
  middlewarePriority(middleware: MiddlewareArgument[]): this {
    this.middlewarePriorityList = [...middleware];
    return this;
  }

  /**
   * Resolve middleware references into executable functions: alias names
   * resolve to their middleware, group names expand to their members in
   * declared order (recursively), and functions pass through untouched.
   * Excluded names/functions are dropped from the expansion, so
   * withoutMiddleware('auth') removes that middleware wherever it came from.
   * Laravel: Router::resolveMiddleware() / MiddlewareNameResolver::resolve()
   */
  resolveMiddleware(middleware: MiddlewareArgument[], excluded: MiddlewareArgument[] = []): Middleware[] {
    return this.sortMiddleware(this.flattenMiddleware(middleware, excluded, new Set()));
  }

  /**
   * Expand every name in the list into its middleware, in order
   */
  private flattenMiddleware(
    middleware: MiddlewareArgument[],
    excluded: MiddlewareArgument[],
    visitingGroups: Set<string>
  ): Middleware[] {
    const flattened: Middleware[] = [];

    for (const entry of middleware) {
      if (typeof entry === 'function') {
        if (!excluded.includes(entry)) {
          flattened.push(entry);
        }
        continue;
      }

      // Excluding a name removes the alias or the whole group expansion
      if (excluded.includes(entry)) {
        continue;
      }

      const group = this.middlewareGroups.get(entry);

      if (group) {
        if (visitingGroups.has(entry)) {
          throw new Error(`Middleware group [${entry}] references itself.`);
        }

        visitingGroups.add(entry);
        flattened.push(...this.flattenMiddleware(group, excluded, visitingGroups));
        visitingGroups.delete(entry);
        continue;
      }

      const alias = this.middlewareAliases.get(entry);

      if (!alias) {
        throw new Error(`Middleware [${entry}] is not registered as an alias or a group.`);
      }

      flattened.push(alias);
    }

    return flattened;
  }

  /**
   * Order middleware by the registered priority map. Port of Laravel's
   * Illuminate\Routing\SortedMiddleware: each pass moves the first
   * out-of-priority-order middleware above the last prioritized one seen,
   * then re-runs until stable; middleware without a priority entry keep
   * their relative positions.
   */
  private sortMiddleware(middleware: Middleware[]): Middleware[] {
    const priority = this.flattenMiddleware(this.middlewarePriorityList, [], new Set());
    let lastIndex = 0;
    let lastPriorityIndex: number | undefined;

    for (let index = 0; index < middleware.length; index++) {
      const priorityIndex = priority.indexOf(middleware[index]);

      if (priorityIndex !== -1) {
        // This middleware outranks the last prioritized one we saw, so move
        // it above that one and re-sort from scratch
        if (lastPriorityIndex !== undefined && priorityIndex < lastPriorityIndex) {
          return this.sortMiddleware(this.moveMiddleware(middleware, index, lastIndex));
        }

        lastIndex = index;
        lastPriorityIndex = priorityIndex;
      }
    }

    return this.uniqueMiddleware(middleware);
  }

  /**
   * Splice a middleware into a new position, removing its old entry
   * Laravel: SortedMiddleware::moveMiddleware()
   */
  private moveMiddleware(middleware: Middleware[], from: number, to: number): Middleware[] {
    const moved = [...middleware];
    const [entry] = moved.splice(from, 1);
    moved.splice(to, 0, entry);
    return moved;
  }

  /**
   * Middleware registered more than once (e.g. by a group and by name) only
   * run once, keeping their first position
   * Laravel: Router::uniqueMiddleware()
   */
  private uniqueMiddleware(middleware: Middleware[]): Middleware[] {
    const seen = new Set<Middleware>();

    return middleware.filter((entry) => {
      if (seen.has(entry)) {
        return false;
      }

      seen.add(entry);
      return true;
    });
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
      try {
        const host = req.header('host');
        const path = Route.normalizePath(req.path);
        const route = this.findRoute(req.method, path, host);

        if (!route) {
          this.respondMethodMismatch(req, res, path, host);
          return;
        }

        context.route = route;

        // Resolve route bindings: Route::bind / Route::model / implicit models
        await this.routeResolver.substituteBindings(route);

        // Store the route on the request
        req.setRoute(route);
        req.params = route.getParameters();

        // Run through middleware pipeline
        const pipeline = new Pipeline(req, res);

        await pipeline.through(this.resolveMiddleware(route.middlewareList, route.excludedMiddleware)).run(async () => {
          // Execute the route action
          await this.runRoute(route, req, res);
        });
      } catch (error) {
        // One shared handler reports and renders every dispatch failure -
        // including validation, authorization and not-found exceptions. The
        // finished response keeps the Kernel's own catch out of the picture.
        await this.getExceptionHandler().handle(req, error, res);
      }
    });
  }

  /**
   * Answer requests that found no route: 405 with an Allow header when the
   * path exists under other verbs, an Allow-bearing response for OPTIONS,
   * and a NotFoundHttpException - rendered by the exception handler - for
   * paths no route claims at all
   */
  private respondMethodMismatch(req: Request, res: Response, path: string, host?: string): void {
    const allowed = this.allowedMethods(path, host);

    if (allowed.length === 0) {
      throw new NotFoundHttpException();
    }

    res.header('Allow', allowed.join(', '));

    if (req.method === 'OPTIONS') {
      res.status(204).send(undefined);
      return;
    }

    res.status(405).send('Method Not Allowed');
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
      if (result instanceof ResponseObject) {
        // Returned response objects (JsonResponse, RedirectResponse,
        // StreamedResponse) deliver themselves onto the transport
        await result.sendTo(res);
      } else if (result instanceof View) {
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
   * FormRequest failures - ValidationException and AccessDeniedHttpException -
   * propagate to the exception handler, which answers 422 with the error bag
   * or 403 respectively.
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
    const args = await this.routeResolver.resolveArguments(reflection, route.getParameters(), req, res);

    return await controller[methodName](...args);
  }

  /**
   * Get all registered routes
   */
  getRoutes(): Route[] {
    return this.routes;
  }
}
