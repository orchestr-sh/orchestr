/**
 * Helper functions - Laravel-style global helpers
 */

import type { StatefulGuard } from '@/Auth/Contracts/Guard';
import type { Ensemble } from '@/Database/Ensemble/Ensemble';
import type { EnsembleClass, Factory, FactoryState } from '@/Database/Factories/Factory';
import type { Encrypter as EncrypterContract } from '@/Encryption/Contracts/Encrypter';
import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import type { HashManager as HashManagerContract } from '@/Hashing/HashManager';
import type { RouteUrlParameters } from '@/Routing/UrlGenerator';
import type { Store as SessionStore } from '@/Session/Contracts/Store';
import type { SessionManager } from '@/Session/SessionManager';
import type { CollectionKey } from '@/Support/Collection';
import type { View } from '@/View/View';
import type { ViewFactory } from '@/View/ViewFactory';
import { resolveModelFactory } from '@/Database/Factories/HasFactory';
import { Application } from '@/Foundation/Application';
import { Arr } from '@/Support/Arr';
import { Collection, collect as createCollection } from '@/Support/Collection';
import { Str } from '@/Support/Str';

// Global application instance for helpers
let globalApp: Application | null = null;

/**
 * Set the global application instance
 * @internal
 */
export function setGlobalApp(app: Application): void {
  globalApp = app;
}

/**
 * Get the global application instance
 * @internal
 */
export function getGlobalApp(): Application | null {
  return globalApp;
}

/**
 * Get a configuration value
 * Laravel: config('app.name') or config('app.name', 'default')
 *
 * @param {string} key
 * @param {any} defaultValue
 * @returns {any}
 */
export function config<T = any>(key?: string, defaultValue?: T): T | ConfigClass {
  if (!globalApp) {
    throw new Error('Application not initialized. Call setGlobalApp() first.');
  }

  const configInstance = globalApp.make<ConfigClass>('config');

  // If no key provided, return the config instance
  if (key === undefined) {
    return configInstance as any;
  }

  return configInstance.get(key, defaultValue);
}

/**
 * Load routes from a directory
 * This helper allows you to dynamically import route files
 */
export async function loadRoutes(routePath: string): Promise<void> {
  try {
    await import(routePath);
  } catch (error) {
    throw new Error(`Failed to load routes from ${routePath}: ${error}`, { cause: error });
  }
}

/**
 * Resolve a path relative to the base path
 */
export function base_path(path: string = ''): string {
  return `${process.cwd()}${path ? '/' + path : ''}`;
}

/**
 * Get the routes directory path
 */
export function routes_path(path: string = ''): string {
  return base_path(`routes${path ? '/' + path : ''}`);
}

/**
 * Get the resources/views directory path
 */
export function resource_path(path: string = ''): string {
  return base_path(`resources${path ? '/' + path : ''}`);
}

/**
 * Get the storage directory path
 * Laravel: storage_path('app/file.txt')
 *
 * Resolves through the application instance when one is running so the
 * helper and the filesystem disks agree on the storage root; falls back to
 * the current working directory otherwise.
 */
export function storage_path(path: string = ''): string {
  if (globalApp) {
    return globalApp.storagePath(path);
  }

  return base_path(`storage${path ? '/' + path : ''}`);
}

/**
 * Create a new view instance.
 * Laravel: view('welcome', ['name' => 'John'])
 *
 * @param {string} name   - Dot-notation view name (e.g. 'welcome', 'layouts.app')
 * @param {Record<string, any>} data - Data to pass to the view
 * @returns {View}
 */
export function view(name: string, data: Record<string, any> = {}): View {
  if (!globalApp) {
    throw new Error('Application not initialized. Call setGlobalApp() first.');
  }

  const factory = globalApp.make<ViewFactory>('view');
  return factory.make(name, data);
}

/**
 * Generate the URL for a named route.
 * Laravel: route('users.show', ['user' => 1])
 *
 * Unused parameters are appended as a query string. The router is resolved
 * from the container lazily (no import here - the Routing layer already
 * depends on this module through Response).
 */
export function route(name: string, parameters?: RouteUrlParameters): string {
  if (!globalApp) {
    throw new Error('Application not initialized. Call setGlobalApp() first.');
  }

  const router = globalApp.make<{ url: (name: string, parameters?: any) => string }>('router');
  return router.url(name, parameters);
}

/**
 * Access the current request's session.
 * Laravel: session() / session('key') / session(['key' => 'value'])
 *
 * Called with no arguments it returns the active session store (or null
 * when no session middleware ran); with a key it reads from the session;
 * with an object it writes every pair. The manager comes from the
 * container, so no import of the Session module is needed here.
 */
export function session(values: Record<string, any>): void;
export function session<T = any>(key: string, defaultValue?: T): T | undefined;
export function session(): SessionStore | null;
export function session(keyOrValues?: string | Record<string, any>, defaultValue?: any): any {
  const store = activeSession();

  if (keyOrValues === undefined) {
    return store;
  }

  if (!store) {
    throw new Error('No active session. Register the session middleware.');
  }

  if (typeof keyOrValues === 'string') {
    return store.get(keyOrValues, defaultValue);
  }

  for (const [key, value] of Object.entries(keyOrValues)) {
    store.put(key, value);
  }

  return undefined;
}

/**
 * Get the CSRF token of the active session.
 * Laravel: csrf_token()
 */
export function csrf_token(): string {
  const store = activeSession();

  if (!store) {
    throw new Error('No active session. Register the session middleware before using csrf_token().');
  }

  return store.token();
}

/**
 * Render the hidden CSRF input for HTML forms.
 * Laravel: csrf_field()
 */
export function csrf_field(): string {
  return `<input type="hidden" name="_token" value="${escapeHtml(csrf_token())}" autocomplete="off">`;
}

/**
 * Resolve the session store the StartSession middleware attached to the
 * running request, or null when sessions are not in play
 */
function activeSession(): SessionStore | null {
  if (!globalApp || !globalApp.bound('session')) {
    return null;
  }

  try {
    return globalApp.make<SessionManager>('session').current();
  } catch {
    return null;
  }
}

/**
 * Escape a value for embedding in HTML attributes
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Access password hashing.
 *
 * With a value it returns that value's hash using the configured driver;
 * with no arguments it hands back the hashing manager for check(),
 * needsRehash(), verifyConfiguration() and driver() work:
 *
 *   const hashed = hash('secret');
 *   hash().check('secret', hashed); // true
 */
export function hash(): HashManagerContract;
export function hash(value: string, options?: Record<string, any>): string;
export function hash(value?: string, options?: Record<string, any>): any {
  const manager = requireHash();

  return value === undefined ? manager : manager.make(value, options);
}

/**
 * Resolve the hashing manager from the container
 */
function requireHash(): HashManagerContract {
  if (!globalApp || !globalApp.bound('hash')) {
    throw new Error('Hashing is not available. Register the HashServiceProvider first.');
  }

  return globalApp.make<HashManagerContract>('hash');
}

/**
 * Encrypt a value with the application encrypter.
 * Laravel: Crypt::encrypt()
 */
export function encrypt(value: unknown, serialize: boolean = true): string {
  return requireEncrypter().encrypt(value, serialize);
}

/**
 * Decrypt a payload produced by encrypt().
 * Laravel: Crypt::decrypt()
 */
export function decrypt<T = any>(payload: string, unserialize: boolean = true): T {
  return requireEncrypter().decrypt<T>(payload, unserialize);
}

/**
 * Resolve the application encrypter from the container
 */
function requireEncrypter(): EncrypterContract {
  if (!globalApp || !globalApp.bound('encrypter')) {
    throw new Error('Encryption is not available. Register the EncryptionServiceProvider first.');
  }

  return globalApp.make<EncrypterContract>('encrypter');
}

/**
 * Access an authentication guard.
 * Laravel: auth() / auth('api')
 *
 * The guard named by the argument (defaults to auth.defaults.guard) comes
 * from the container-bound AuthManager, so no import of the Auth module is
 * needed here.
 */
export function auth(guard?: string): StatefulGuard {
  if (!globalApp || !globalApp.bound('auth')) {
    throw new Error('Authentication is not available. Register the AuthServiceProvider first.');
  }

  return globalApp.make<{ guard(name?: string): StatefulGuard }>('auth').guard(guard);
}

/**
 * Create a new factory instance for the given Ensemble model class.
 * Laravel: factory(User::class) - the model can equally call User.factory().
 *
 * Resolution follows the one convention shared by HasFactory and
 * Ensemble.factory(): the registered User -> UserFactory pairing, or the
 * model's static newFactory() override. Pass a count, and optionally a
 * state, to seed the factory:
 *
 *   factory(User, 3).create()
 *   factory(User, { admin: true }).create()
 */
export function factory<TModel extends Ensemble>(
  model: EnsembleClass<TModel>,
  countOrState?: number | FactoryState,
  state?: FactoryState
): Factory<TModel> {
  return resolveModelFactory(model, countOrState, state);
}

/**
 * Re-export of the fake() generator helper so every global helper lives in
 * one place; the implementation stays in Database/Factories/Fake (DRY).
 */
export { fake } from '@/Database/Factories/Fake';

/**
 * Re-export of the collection factory, so all global helpers live in one
 * place. The implementation stays in Support/Collection (DRY).
 */
export { collect } from '@/Support/Collection';

/**
 * Re-exports of the HTTP abort helpers, implementation in
 * Foundation/Exceptions (the exception handler renders the thrown exception).
 * Laravel: abort(), abort_if(), abort_unless()
 */
export { abort, abort_if, abort_unless } from '@/Foundation/Exceptions/abort';

/**
 * Access the Str utility class without importing it directly. Laravel's
 * `str()` helper returns a fluent Stringable; this port keeps Str purely
 * static, so str() hands back the class itself:
 *
 * str().slug('Hello World') // 'hello-world'
 */
export function str(): typeof Str {
  return Str;
}

/**
 * Access the Arr utility class without importing it directly:
 *
 * arr().get({ a: { b: 1 } }, 'a.b') // 1
 */
export function arr(): typeof Arr {
  return Arr;
}

/**
 * Get a value using "dot" notation, with '*' wildcard support.
 * Laravel: data_get($array, 'products.0.name')
 */
export function data_get<T = any>(target: any, key?: CollectionKey | CollectionKey[] | null, defaultValue?: T): any {
  if (key === null || key === undefined) {
    return target;
  }

  return Arr.get(target, key, defaultValue);
}

/**
 * Set a value using "dot" notation, creating missing intermediate
 * objects / arrays along the way. Laravel: data_set($array, 'a.b', 2)
 *
 * Objects and arrays are mutated in place; the target is also returned
 * for convenience.
 */
export function data_set(target: any, key: CollectionKey | CollectionKey[], value: any): any {
  if (target === null || target === undefined) {
    return target;
  }

  const keys = Array.isArray(key) ? key : [key];

  for (const eachKey of keys) {
    dataSetOne(target, String(eachKey), value);
  }

  return target;
}

/**
 * Resolve the given value if it is a function, otherwise return it as-is.
 * Laravel: value($value)
 */
export function value<T>(value: T | ((...args: any[]) => T), ...args: any[]): T {
  return typeof value === 'function' ? (value as (...inner: any[]) => T)(...args) : value;
}

/**
 * Call the given callback with the provided value, then return the value.
 * Laravel: tap($value, $callback)
 */
export function tap<T>(value: T, callback?: (value: T) => unknown): T {
  if (callback) {
    callback(value);
  }

  return value;
}

/**
 * Create a safe accessor for nullable values. When a callback is given it
 * is invoked with the value; otherwise an Optional wrapper is returned
 * that resolves property / method access to undefined when the underlying
 * value is null or undefined.
 *
 * Laravel: optional($user)->name
 */
export function optional<T>(value: T | null | undefined, callback?: (value: T | null | undefined) => any): any {
  if (callback) {
    return callback(value);
  }

  const wrapper = new Optional(value);

  return new Proxy(wrapper, {
    get(target, property, receiver) {
      if (typeof property === 'symbol' || Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver);
      }

      if (value === null || value === undefined) {
        return undefined;
      }

      return (value as any)[property];
    },
  });
}

/**
 * Throw the given exception if the given condition evaluates truthy.
 * Laravel: throw_if($condition, Exception::class, ...$args)
 */
export function throw_if(condition: unknown, exception?: any, ...args: any[]): void {
  if (value(condition)) {
    throw buildException(exception, args);
  }
}

/**
 * Throw the given exception unless the given condition evaluates truthy.
 * Laravel: throw_unless($condition, Exception::class, ...$args)
 */
export function throw_unless(condition: unknown, exception?: any, ...args: any[]): void {
  if (!value(condition)) {
    throw buildException(exception, args);
  }
}

/**
 * Get the "basename" for a given class / instance / class string.
 * Laravel: class_basename(User::class) // 'User'
 */
export function class_basename(target: unknown): string {
  let name: string;

  if (typeof target === 'string') {
    name = target;
  } else if (typeof target === 'function') {
    name = target.name;
  } else if (target !== null && target !== undefined) {
    const constructorName = (target as { constructor?: { name?: string } }).constructor?.name;
    name = typeof constructorName === 'string' ? constructorName : '';
  } else {
    return '';
  }

  return name.split(/[/\\]/).pop() ?? name;
}

/**
 * Convert a string to snake_case (legacy Laravel helper).
 */
export function snake_case(value: string): string {
  return Str.snake(value);
}

/**
 * Convert a string to camelCase (legacy Laravel helper).
 */
export function camel_case(value: string): string {
  return Str.camel(value);
}

/**
 * Convert a string to StudlyCase (legacy Laravel helper).
 */
export function studly_case(value: string): string {
  return Str.studly(value);
}

/**
 * Convert a string to kebab-case.
 */
export function kebab_case(value: string): string {
  return Str.kebab(value);
}

/**
 * Convert a string to Title Case.
 */
export function title_case(value: string): string {
  return Str.title(value);
}

/**
 * Get a Date instance representing the current moment.
 * Laravel: now() (Carbon). This port returns a plain Date to keep the
 * helpers free of framework dependencies.
 */
export function now(): Date {
  return new Date();
}

/**
 * Get a Date instance representing midnight at the start of today
 * (system timezone). Laravel: today() (Carbon::today).
 */
export function today(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);

  return date;
}

/**
 * Proxy-based null-safe accessor backing the optional() helper.
 */
export class Optional<T> {
  constructor(private readonly inner: T | null | undefined) {}

  /**
   * The underlying value.
   */
  get value(): T | null | undefined {
    return this.inner;
  }

  /**
   * Get an item from the underlying value using "dot" notation.
   */
  get(key: CollectionKey, defaultValue?: any): any {
    return this.inner === null || this.inner === undefined ? defaultValue : Arr.get(this.inner, key, defaultValue);
  }

  /**
   * Call the given method on the underlying value, returning undefined
   * when the value is null.
   */
  call(methodOrCallback: string | ((target: T) => any), ...args: any[]): any {
    if (this.inner === null || this.inner === undefined) {
      return undefined;
    }

    if (typeof methodOrCallback === 'function') {
      return methodOrCallback(this.inner);
    }

    const method = (this.inner as any)[methodOrCallback];

    return typeof method === 'function' ? method.apply(this.inner, args) : undefined;
  }

  /**
   * Call the given method, throwing when the value is null.
   */
  mustCall(methodOrCallback: string | ((target: T) => any), ...args: any[]): any {
    if (this.inner === null || this.inner === undefined) {
      throw new Error('Attempted to call method on a null value.');
    }

    return this.call(methodOrCallback, ...args);
  }

  /**
   * Wrap the underlying value in a Collection.
   */
  collect<R = any>(): Collection<R> {
    return createCollection<R>(this.inner === null || this.inner === undefined ? [] : (this.inner as any));
  }
}

/**
 * Resolve a '*' wildcard data_set path segment by segment.
 */
function dataSetOne(target: any, path: string, value: any): void {
  const segments = path.split('.');
  const wildcardIndex = segments.indexOf('*');

  if (wildcardIndex !== -1) {
    const childSegments = wildcardIndex === 0 ? [] : segments.slice(0, wildcardIndex);
    const child = childSegments.length === 0 ? target : Arr.get(target, childSegments.join('.'));
    const parents = Array.isArray(child)
      ? child.map((_item, index) => index)
      : child !== null && child !== undefined && typeof child === 'object'
        ? Object.keys(child)
        : [];

    for (const parent of parents) {
      const rest = [
        ...(childSegments.length === 0 ? [] : [childSegments.join('.')]),
        String(parent),
        ...segments.slice(wildcardIndex + 1),
      ];

      dataSetOne(target, rest.join('.'), value);
    }

    return;
  }

  let container: any = target;

  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index];
    const next = container[segment];

    if (next === null || next === undefined || typeof next !== 'object') {
      container[segment] = /^\d+$/.test(segments[index + 1]) ? [] : {};
    }

    container = container[segment];
  }

  container[segments[segments.length - 1]] = value;
}

/**
 * Normalise a throw_if / throw_unless exception argument into a thrown
 * value: string becomes an Error, a class is instantiated with the
 * remaining arguments, an Error instance is re-thrown.
 */
function buildException(exception: any, args: any[]): Error {
  if (exception === undefined || exception === null) {
    return new Error('One or many conditions have not been met which cause the explicit exception to be thrown.');
  }

  if (typeof exception === 'string') {
    return new Error(exception);
  }

  if (exception instanceof Error) {
    return exception;
  }

  if (typeof exception === 'function') {
    try {
      return new exception(...args);
    } catch (error) {
      // Not constructible (e.g. a factory function): call it instead.
      const produced = exception(...args);

      return produced instanceof Error ? produced : new Error(String(produced));
    }
  }

  return new Error(String(exception));
}
