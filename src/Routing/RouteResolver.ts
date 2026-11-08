/**
 * RouteResolver - Route model binding and controller parameter resolution
 *
 * Consolidates every piece of reflection the routing layer needs so the
 * Router and the HTTP kernel share one implementation (Laravel splits this
 * between `Illuminate\Routing\ImplicitRouteBinding`, `Route::parameter()`
 * and `BoundMethod::resolveMethodDependencies()`):
 *
 * - Explicit bindings: `Route.bind(key, callback)` / `Route.model(key, Model)`
 * - Implicit bindings: controller parameters type-hinted as an Ensemble model
 *   whose name matches a route parameter are resolved by their route key.
 * - Scoped bindings: a child model binding constrained by its parent binding.
 * - Controller dependency injection: `Request`, `Response`, `FormRequest`
 *   subclasses, route parameters by name, bound models, and container
 *   resolvable services, in any order.
 *
 * Parameter *types* come from TypeScript's `design:paramtypes` metadata, so
 * actions must carry a method decorator (`@Action()` / `@ValidateRequest()`)
 * for `emitDecoratorMetadata` to reflect them. Parameter *names* are parsed
 * from the compiled function signature. Actions without metadata fall back to
 * the historical `(request, response)` calling convention.
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { Application } from '@/Foundation/Application';
import { FormRequest } from '@/Foundation/Http/FormRequest';
import { Str } from '@/Support/Str';
import { ModelNotFoundException } from './ModelNotFoundException';
import { Request } from './Request';
import { Response } from './Response';
import { Route, RouteAction } from './Route';

/**
 * Explicit parameter binder
 * Laravel: Route::bind('id', fn ($value, $route) { ... })
 */
export type RouteBinder = (value: any, route: Route, parameterName: string) => any;

/**
 * Reflected signature of a route action
 */
export interface ActionReflection {
  /** Parameter names in declaration order; `undefined` for destructured/rest patterns */
  names: (string | undefined)[];
  /** Whether the parameter declares a default value */
  hasDefault: boolean[];
  /** `design:paramtypes` entries in declaration order (may be shorter than `names`) */
  types: any[];
}

const EMPTY_REFLECTION: ActionReflection = { names: [], hasDefault: [], types: [] };

/**
 * Primitive wrapper types `design:paramtypes` emits which the container
 * cannot resolve as services
 */
const NON_SERVICES: Function[] = [Object, String, Number, Boolean, Symbol, BigInt, Function];

export class RouteResolver {
  private app: Application;
  private binders: Map<string, RouteBinder> = new Map();
  private modelBindings: Map<string, typeof Ensemble> = new Map();

  constructor(app: Application) {
    this.app = app;
  }

  // -------------------------------------------------------------------------
  // Explicit binding registration
  // -------------------------------------------------------------------------

  /**
   * Register an explicit parameter binder
   * Laravel: Route::bind('user', fn ($value) => ...)
   */
  bind(key: string, callback: RouteBinder): void {
    this.binders.set(key, callback);
  }

  /**
   * Register an explicit model binding for a route parameter
   * Laravel: Route::model('user', User::class)
   */
  model(key: string, ModelClass: typeof Ensemble): void {
    if (!RouteResolver.isModelClass(ModelClass)) {
      throw new Error(`Route model binding [${key}] requires an Ensemble model class.`);
    }

    this.modelBindings.set(key, ModelClass);
  }

  // -------------------------------------------------------------------------
  // Binding substitution
  // -------------------------------------------------------------------------

  /**
   * Substitute the route's raw parameters with their bound values, mutating
   * `route.parameters` in place so `Request::route(key)` and `Route::parameters`
   * both observe resolved models.
   *
   * Laravel: RouteParameterBinder + ImplicitRouteBinding::resolveForRoute()
   */
  async substituteBindings(route: Route): Promise<void> {
    const parameterNames = Object.keys(route.parameters);
    if (parameterNames.length === 0) {
      return;
    }

    const reflection = this.reflectAction(route.action);
    const typesByParameter = new Map<string, any>();

    reflection.names.forEach((name, index) => {
      if (name !== undefined) {
        typesByParameter.set(name, reflection.types[index]);
      }
    });

    let parent: Ensemble | null = null;

    for (const parameter of parameterNames) {
      const raw = route.parameters[parameter];

      // A missing optional segment (`:id?` matching an empty string) is never bound
      if (raw === '') {
        continue;
      }

      const binder = this.binders.get(parameter);
      if (binder) {
        const bound = await binder(raw, route, parameter);
        route.parameters[parameter] = bound;

        if (bound instanceof Ensemble) {
          parent = bound;
        }

        continue;
      }

      const ModelClass = this.modelBindings.get(parameter) ?? typesByParameter.get(parameter);

      if (ModelClass !== undefined && RouteResolver.isModelClass(ModelClass)) {
        const child = await this.resolveModel(
          ModelClass as typeof Ensemble,
          raw,
          route.scopedBindings ? parent : null,
          parameter
        );

        route.parameters[parameter] = child;
        parent = child;
      }
    }
  }

  /**
   * Resolve an Ensemble model for a bound route parameter
   *
   * Queries by the model's route key name, coerces integer keys, and - when
   * scoped bindings are active - constrains the child query by its parent.
   */
  async resolveModel(
    ModelClass: typeof Ensemble,
    rawValue: any,
    parent: Ensemble | null,
    parameterName: string
  ): Promise<Ensemble> {
    const instance = new (ModelClass as unknown as new () => Ensemble)();
    const routeKey = instance.getRouteKeyName();
    const value = this.coerceBindingValue(instance, rawValue);

    const query = (ModelClass as any).query();

    if (parent) {
      const foreignKey = this.foreignKeyForChild(parent, ModelClass, parameterName);
      if (foreignKey) {
        query.where(foreignKey, '=', parent.getKey());
      }
    }

    const model = await query.where(routeKey, '=', value).first();

    if (!model) {
      throw ModelNotFoundException.forModel(ModelClass, [value]);
    }

    return model;
  }

  /**
   * Determine the foreign key linking a child model to its bound parent.
   *
   * Prefers an actual relation defined on the parent whose related model is
   * the child class, falling back to the `snake_case(parent)_key` convention
   * the `hasMany()` default uses (`users` binding `posts` => `user_id`).
   */
  private foreignKeyForChild(parent: Ensemble, ChildClass: typeof Ensemble, parameterName: string): string | null {
    const childName = ChildClass.name;
    const candidates = [Str.plural(Str.camel(childName)), Str.camel(childName), parameterName];

    for (const relationName of candidates) {
      const relationMethod = (parent as any)[relationName];

      if (typeof relationMethod !== 'function') {
        continue;
      }

      try {
        const relation = relationMethod.call(parent);

        if (relation && typeof relation.getRelated === 'function') {
          const related = relation.getRelated();

          if (related && related.constructor === ChildClass) {
            const foreignKey = (relation as any).foreignKey ?? (relation as any).getForeignKey?.();
            if (typeof foreignKey === 'string') {
              return foreignKey;
            }
          }
        }
      } catch {
        // Not a relation method - ignore and keep looking
      }
    }

    const parentKeyName = parent.getKeyName();
    return `${Str.snake(parent.constructor.name)}_${parentKeyName}`;
  }

  /**
   * Cast a raw URL segment to the model's key type, the way Laravel's
   * implicit binding respects `getKeyType()` before querying
   */
  private coerceBindingValue(instance: Ensemble, rawValue: any): any {
    if (typeof rawValue !== 'string') {
      return rawValue;
    }

    if (instance.getKeyType() === 'int' && /^-?\d+$/.test(rawValue)) {
      return parseInt(rawValue, 10);
    }

    return rawValue;
  }

  // -------------------------------------------------------------------------
  // Controller dependency injection
  // -------------------------------------------------------------------------

  /**
   * Build the argument list for a controller action
   *
   * Resolution order per parameter:
   * 1. `FormRequest` subclass - instantiated and validated (throws on failure)
   * 2. `Request` (or subclass) - the current request
   * 3. `Response` - the current response
   * 4. Route parameter with the same name (raw string or bound model)
   * 5. Container-resolvable service type
   * 6. Untyped `req`/`res`-style fallbacks by position/name
   *
   * Actions without any reflected types keep the historical behaviour of
   * receiving `(request, response)` positionally.
   */
  async resolveArguments(
    reflection: ActionReflection,
    parameters: Record<string, any>,
    req: Request,
    res: Response
  ): Promise<any[]> {
    const arity = Math.max(reflection.names.length, reflection.types.length);

    if (arity === 0) {
      return [];
    }

    const hasTypeMetadata = reflection.types.some((type) => type !== undefined && type !== Object);

    if (!hasTypeMetadata) {
      // Legacy convention: no usable reflection, pass the classic pair
      return [req, res].slice(0, arity);
    }

    const args: any[] = [];

    for (let index = 0; index < arity; index++) {
      args.push(await this.resolveArgument(index, reflection, parameters, req, res));
    }

    return args;
  }

  private async resolveArgument(
    index: number,
    reflection: ActionReflection,
    parameters: Record<string, any>,
    req: Request,
    res: Response
  ): Promise<any> {
    const type = reflection.types[index];
    const name = reflection.names[index];

    // 1. FormRequest subclasses are created and validated on the spot
    if (RouteResolver.isFormRequestClass(type)) {
      const formRequest = new (type as unknown as new (request: Request) => FormRequest)(req);
      await formRequest.validate();
      return formRequest;
    }

    // 2/3. The framework's own Request/Response objects
    if (RouteResolver.isRequestClass(type)) {
      return req;
    }

    if (RouteResolver.isResponseClass(type)) {
      return res;
    }

    // 4. Route parameters by name - covers scalars and already-bound models
    if (name !== undefined && Object.prototype.hasOwnProperty.call(parameters, name)) {
      return parameters[name];
    }

    // 5. Container-resolvable services (model classes are never auto-constructed)
    if (RouteResolver.isResolvableService(type)) {
      try {
        return this.app.make(type);
      } catch (error) {
        if (reflection.hasDefault[index]) {
          return undefined;
        }

        throw error;
      }
    }

    // 6. Untyped fallback: `req`/`res` shaped signatures still get their pair
    if (type === undefined || type === Object) {
      if (
        /^res(ponse)?$/i.test(name ?? '') ||
        (index === 1 && reflection.names[0] !== undefined && /^req(uest)?$/i.test(reflection.names[0] ?? ''))
      ) {
        return res;
      }

      if (index === 0 || /^req(uest)?$/i.test(name ?? '')) {
        return req;
      }
    }

    return undefined;
  }

  // -------------------------------------------------------------------------
  // Reflection
  // -------------------------------------------------------------------------

  /**
   * Reflect a route action's method signature
   *
   * Controller actions read `design:paramtypes` off the class prototype;
   * closures are read directly. Unresolvable actions (string controllers not
   * bound in the container, missing methods) reflect as empty.
   */
  reflectAction(action: RouteAction): ActionReflection {
    if (Array.isArray(action)) {
      const [ControllerClass, methodName] = action as [any, string];
      return this.reflectMethod(ControllerClass?.prototype, methodName);
    }

    if (typeof action === 'string' && action.includes('@')) {
      const [controllerName, methodName] = action.split('@');

      try {
        const controller = this.app.make<any>(controllerName);
        return this.reflectMethod(Object.getPrototypeOf(controller), methodName);
      } catch {
        return EMPTY_REFLECTION;
      }
    }

    if (typeof action === 'function') {
      return {
        names: RouteResolver.parseParameterNames(action),
        hasDefault: RouteResolver.parseHasDefaults(action),
        types: Reflect.getMetadata('design:paramtypes', action) ?? [],
      };
    }

    return EMPTY_REFLECTION;
  }

  /**
   * Reflect a single method on a controller prototype (or a resolved
   * controller's prototype for string actions)
   */
  reflectMethod(prototype: any, methodName: string): ActionReflection {
    const method = prototype ? prototype[methodName] : undefined;

    if (typeof method !== 'function') {
      return EMPTY_REFLECTION;
    }

    return {
      names: RouteResolver.parseParameterNames(method),
      hasDefault: RouteResolver.parseHasDefaults(method),
      types: Reflect.getMetadata('design:paramtypes', prototype, methodName) ?? [],
    };
  }

  // -------------------------------------------------------------------------
  // Type predicates
  // -------------------------------------------------------------------------

  /**
   * Determine if a value is an Ensemble model class
   */
  static isModelClass(value: any): value is typeof Ensemble {
    if (typeof value !== 'function') {
      return false;
    }

    let current = value;
    while (current) {
      if (current === Ensemble) {
        return true;
      }
      current = Object.getPrototypeOf(current);
    }

    return false;
  }

  /**
   * Determine if a class is FormRequest itself or a subclass of it
   */
  static isFormRequestClass(cls: any): cls is typeof FormRequest {
    if (!cls || typeof cls !== 'function') {
      return false;
    }

    let current = cls;
    while (current) {
      if (current === FormRequest) {
        return true;
      }
      current = Object.getPrototypeOf(current);
    }

    return false;
  }

  /**
   * Determine if a class is Request or a subclass of it
   */
  static isRequestClass(cls: any): boolean {
    if (!cls || typeof cls !== 'function') {
      return false;
    }

    return cls === Request || cls.prototype instanceof Request;
  }

  /**
   * Determine if a class is Response or a subclass of it
   */
  static isResponseClass(cls: any): boolean {
    if (!cls || typeof cls !== 'function') {
      return false;
    }

    return cls === Response || cls.prototype instanceof Response;
  }

  /**
   * Determine if a parameter type is something the container can build
   */
  static isResolvableService(type: any): type is Function {
    if (typeof type !== 'function' || NON_SERVICES.includes(type)) {
      return false;
    }

    // Arrow functions and other typeless callables carry no constructible prototype
    if (!type.prototype) {
      return false;
    }

    if (RouteResolver.isModelClass(type) || RouteResolver.isFormRequestClass(type)) {
      return false;
    }

    if (RouteResolver.isRequestClass(type) || RouteResolver.isResponseClass(type)) {
      return false;
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Signature parsing
  // -------------------------------------------------------------------------

  /**
   * Extract parameter names from a compiled function's source
   *
   * Destructured and defaulted object/array parameters have no usable name and
   * are reported as `undefined` at their position.
   */
  static parseParameterNames(fn: Function): (string | undefined)[] {
    return RouteResolver.parseParameters(fn).map((entry) => entry.name);
  }

  /**
   * Extract per-parameter "has a default value" flags from the signature
   */
  static parseHasDefaults(fn: Function): boolean[] {
    return RouteResolver.parseParameters(fn).map((entry) => entry.hasDefault);
  }

  /**
   * Parse a `(...)` parameter list out of `Function.prototype.toString()`
   */
  private static parseParameters(fn: Function): Array<{ name: string | undefined; hasDefault: boolean }> {
    const source = fn.toString();
    const open = source.indexOf('(');

    if (open === -1) {
      return [];
    }

    let depth = 0;
    let close = -1;
    let quote: string | null = null;

    for (let i = open; i < source.length; i++) {
      const char = source[i];

      if (quote) {
        if (char === '\\') {
          i++;
        } else if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }

      if (char === '(' || char === '[' || char === '{') {
        depth++;
      } else if (char === ')' || char === ']' || char === '}') {
        depth--;

        if (char === ')' && depth === 0) {
          close = i;
          break;
        }
      }
    }

    if (close === -1) {
      return [];
    }

    const body = source.slice(open + 1, close).trim();

    if (body === '') {
      return [];
    }

    return RouteResolver.splitTopLevel(body).map((rawToken) => {
      let token = rawToken.trim();
      let hasDefault = false;

      // Strip decorators/modifiers that may precede a parameter (TypeScript
      // emits constructor accessibility markers as plain assignments, so this
      // is mostly a safety net)
      const equals = RouteResolver.indexOfTopLevelEquals(token);

      if (equals !== -1) {
        hasDefault = true;
        token = token.slice(0, equals).trim();
      }

      const isRest = token.startsWith('...');

      if (isRest) {
        token = token.slice(3).trim();
      }

      const match = /^([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(token);

      return { name: match ? match[1] : undefined, hasDefault };
    });
  }

  /**
   * Split a parameter list on top-level commas only
   */
  private static splitTopLevel(value: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let quote: string | null = null;
    let current = '';

    for (let i = 0; i < value.length; i++) {
      const char = value[i];

      if (quote) {
        current += char;

        if (char === '\\') {
          current += value[++i] ?? '';
        } else if (char === quote) {
          quote = null;
        }

        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        current += char;
        continue;
      }

      if (char === '(' || char === '[' || char === '{') {
        depth++;
      } else if (char === ')' || char === ']' || char === '}') {
        depth--;
      }

      if (char === ',' && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim() !== '' || parts.length > 0) {
      parts.push(current);
    }

    return parts;
  }

  /**
   * Find the position of the first top-level `=` that introduces a default
   * value (ignoring comparisons inside nested structures, strings and `=>`)
   */
  private static indexOfTopLevelEquals(value: string): number {
    let depth = 0;
    let quote: string | null = null;

    for (let i = 0; i < value.length; i++) {
      const char = value[i];

      if (quote) {
        if (char === '\\') {
          i++;
        } else if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }

      if (char === '(' || char === '[' || char === '{') {
        depth++;
      } else if (char === ')' || char === ']' || char === '}') {
        depth--;
      }

      if (depth === 0 && char === '=') {
        // Skip `==`, `===`, `=>`
        const next = value[i + 1];
        const prev = value[i - 1];

        if (
          next === '=' ||
          next === '>' ||
          prev === '!' ||
          prev === '=' ||
          prev === '+' ||
          prev === '-' ||
          prev === '*' ||
          prev === '/'
        ) {
          continue;
        }

        return i;
      }
    }

    return -1;
  }
}
