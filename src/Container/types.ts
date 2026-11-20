import type { Container } from './Container';

/**
 * Anything the container can key a binding by: a name, a symbol, or a class.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export type Abstract = string | symbol | Function;

/**
 * A resolvable implementation: a factory closure (receiving the container
 * and the active parameter overrides) or a constructible class.
 */
export type Concrete<T = any> =
  | ((container: Container, parameters?: ParameterOverrides) => T)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | (new (...args: any[]) => T);

/**
 * A registered binding. `scoped` marks bindings created by `scoped()` so
 * their cached instances are dropped by `forgetScopedInstances()`.
 */
export type Binding = {
  concrete: Concrete;
  shared: boolean;
  scoped?: boolean;
};

/**
 * Explicit parameter substitutions. An array overrides constructor
 * arguments positionally (the historical `make(abstract, [app])`
 * convention); a record overrides by parameter name, like Laravel's
 * named `$parameters` arrays.
 */
export type ParameterOverrides = any[] | Record<string, any>;

/**
 * Every callable shape `Container::call()` accepts. Laravel's
 * `callable|string` plus class strings: a closure, `[Class|instance,
 * 'method']`, `'Class@method'`, `'Class'` (whose `__invoke`/default method
 * runs), or an object exposing `__invoke`.
 */
export type CallableArgument = ((...args: any[]) => any) | string | [Abstract | object, string] | object;

/**
 * Decoration callback registered with `extend()`. Receives the resolved
 * instance and the container, and returns the replacement value.
 */
export type Extender = (instance: any, container: Container) => any;

/**
 * Callback registered with `rebinding()`. Fires when a resolved abstract
 * is registered again, with the freshly built instance.
 */
export type RebindingCallback = (container: Container, instance: any) => void;

/**
 * Callback registered with `resolving()` / `afterResolving()`. Fires every
 * time the abstract is built (not on cached-instance returns).
 */
export type ResolvingCallback = (instance: any, container: Container) => void;

/**
 * Custom resolver accepted by `tagged(tag, resolver)`.
 */
export type TagResolver = (abstract: Abstract, container: Container) => any;

/**
 * Determine whether an overrides value carries anything to substitute.
 *
 * Named (record) overrides always count: Laravel lets them bypass the
 * shared-instance cache so overrides never leak into the singleton.
 * Positional arrays are orchestr's legacy `make(abstract, [args])`
 * convention, which historically returned the cached singleton, so they
 * keep doing that here.
 */
export function hasNamedOverrides(parameters: ParameterOverrides): boolean {
  return !Array.isArray(parameters) && Object.keys(parameters).length > 0;
}
