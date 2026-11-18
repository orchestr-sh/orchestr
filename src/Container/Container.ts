import 'reflect-metadata';
import type {
  Abstract,
  Binding,
  CallableArgument,
  Concrete,
  Extender,
  ParameterOverrides,
  RebindingCallback,
  ResolvingCallback,
  TagResolver,
} from './types';
import { BindingRegistry } from './BindingRegistry';
import { CallableResolver } from './CallableResolver';
import { ContextualBindingBuilder } from './ContextualBindingBuilder';
import { ContextualRegistry } from './ContextualRegistry';
import { DependencyResolver } from './DependencyResolver';
import { LifecycleHooks } from './LifecycleHooks';
import { ParameterReflector, isClosure } from './ParameterReflector';
import { hasNamedOverrides } from './types';

export type {
  Abstract,
  Binding,
  CallableArgument,
  Concrete,
  Extender,
  ParameterOverrides,
  RebindingCallback,
  ResolvingCallback,
  TagResolver,
};

/**
 * Service Container - Laravel's IoC Container
 *
 * Handles dependency injection and service resolution. The class is a
 * thin orchestrator over focused collaborators: `BindingRegistry` keeps
 * the state (bindings, instances, aliases, resolved marks, tags),
 * `ContextualRegistry` answers "what does this consumer need instead?",
 * `LifecycleHooks` stores extend/rebinding/resolving callbacks, and
 * `DependencyResolver` + `CallableResolver` + `ParameterReflector`
 * implement the single injection pipeline every resolution path shares:
 * `make`, `makeWith`, `build`, `call`, contextual bindings, and tags.
 */
export class Container {
  protected registry: BindingRegistry = new BindingRegistry();
  protected hooks: LifecycleHooks = new LifecycleHooks();
  protected contextualBindings: ContextualRegistry = new ContextualRegistry();
  protected dependencies: DependencyResolver = new DependencyResolver(this);

  /** Concretions currently being built - the contextual binding consumer */
  private buildStack: Abstract[] = [];

  /** Per-build parameter overrides, Laravel's `$with` stack */
  private parameterOverrides: ParameterOverrides[] = [];

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register a binding with the container
   * Laravel: $app->bind(abstract, concrete)
   */
  bind<T>(abstract: Abstract, concrete: Concrete<T> | null = null, shared: boolean = false): void {
    // Laravel fires "rebound" callbacks only when the abstract had
    // already been resolved before the re-registration.
    const wasResolved = this.resolved(abstract);

    if (this.registry.hasResolved(abstract) && !shared) {
      // If already resolved and not shared, clear the instance
      this.registry.dropStaleInstances(abstract);
      this.registry.deleteResolved(abstract);
    }

    if (concrete === null) {
      concrete = abstract as Concrete<T>;
    }

    this.registry.setBinding(abstract, { concrete, shared });

    if (wasResolved) {
      this.fireRebound(abstract);
    }
  }

  /**
   * Register a shared binding (singleton) in the container
   * Laravel: $app->singleton(abstract, concrete)
   */
  singleton<T>(abstract: Abstract, concrete: Concrete<T> | null = null): void {
    this.bind(abstract, concrete, true);
  }

  /**
   * Register a scoped binding: shared like a singleton, but dropped by
   * `forgetScopedInstances()` at request/scope boundaries.
   * Laravel: $app->scoped(abstract, concrete)
   */
  scoped<T>(abstract: Abstract, concrete: Concrete<T> | null = null): void {
    this.bind(abstract, concrete, true);

    const binding = this.registry.getBinding(abstract);

    if (binding) {
      this.registry.setBinding(abstract, { concrete: binding.concrete, shared: true, scoped: true });
    }
  }

  /**
   * Register an existing instance as shared in the container
   * Laravel: $app->instance(abstract, instance)
   */
  instance<T>(abstract: Abstract, instance: T): T {
    const isBound = this.bound(abstract);

    // The name now identifies a live instance rather than an alias.
    this.registry.forgetAlias(abstract);
    this.registry.setInstance(abstract, instance);

    if (isBound) {
      this.fireRebound(abstract);
    }

    return instance;
  }

  /**
   * Alias a type to a different name
   * Laravel: $app->alias(abstract, alias)
   */
  alias(abstract: Abstract, alias: Abstract): void {
    this.registry.setAlias(abstract, alias);
  }

  /**
   * "Extend" an abstract type in the container. The closure receives the
   * resolved instance and the container and returns the replacement, and
   * runs on every build of the abstract (Laravel: $app->extend).
   */
  extend(abstract: Abstract, extension: Extender): void {
    abstract = this.getAlias(abstract);

    // Instances already in hand are decorated immediately, exactly like
    // Laravel; future builds pick the closure off the hooks registry.
    if (this.registry.hasInstance(abstract)) {
      this.registry.setInstance(abstract, extension(this.registry.getInstance(abstract), this));
      this.fireRebound(abstract);

      return;
    }

    this.hooks.addExtender(abstract, extension);

    if (this.resolved(abstract)) {
      this.fireRebound(abstract);
    }
  }

  /**
   * Remove all extension closures registered for an abstract
   * Laravel: $app->forgetExtenders(abstract)
   */
  forgetExtenders(abstract: Abstract): void {
    this.hooks.forgetExtenders(this.getAlias(abstract));
  }

  /**
   * Bind a new callback to an abstract's rebind event, fired when the
   * abstract is registered again after it has already been resolved.
   * Laravel: $app->rebinding(abstract, callback)
   */
  rebinding(abstract: Abstract, callback: RebindingCallback): any {
    abstract = this.getAlias(abstract);

    this.hooks.addReboundCallback(abstract, callback);

    if (this.bound(abstract)) {
      return this.make(abstract);
    }
  }

  /**
   * Register a resolving callback, fired every time the abstract is
   * built (not on cached-instance returns). Pass just a closure to hook
   * every resolution.
   * Laravel: $app->resolving(abstract, callback)
   */
  resolving(abstract: Abstract, callback: ResolvingCallback): void;
  resolving(callback: ResolvingCallback): void;
  resolving(abstract: Abstract | ResolvingCallback, callback?: ResolvingCallback): void {
    if (callback === undefined) {
      this.hooks.addResolvingCallback('*', abstract as ResolvingCallback);

      return;
    }

    this.hooks.addResolvingCallback(this.getAlias(abstract as Abstract), callback);
  }

  /**
   * Register an afterResolving callback - an alias of the second phase of
   * Laravel's `resolving` event, fired after all resolving hooks.
   * Laravel: $app->afterResolving(abstract, callback)
   */
  afterResolving(abstract: Abstract, callback: ResolvingCallback): void;
  afterResolving(callback: ResolvingCallback): void;
  afterResolving(abstract: Abstract | ResolvingCallback, callback?: ResolvingCallback): void {
    if (callback === undefined) {
      this.hooks.addAfterResolvingCallback('*', abstract as ResolvingCallback);

      return;
    }

    this.hooks.addAfterResolvingCallback(this.getAlias(abstract as Abstract), callback);
  }

  // -------------------------------------------------------------------------
  // Contextual bindings
  // -------------------------------------------------------------------------

  /**
   * Begin a contextual binding: `when(consumer).needs(dependency).give(implementation)`
   * Laravel: $app->when(consumer)
   */
  when(consumer: Abstract | Abstract[]): ContextualBindingBuilder {
    const consumers = (Array.isArray(consumer) ? consumer : [consumer]).map((entry) => this.getAlias(entry));

    return new ContextualBindingBuilder(this, consumers);
  }

  /**
   * Add a contextual binding directly.
   * Laravel: $app->addContextualBinding(consumer, abstract, implementation)
   */
  addContextualBinding(consumer: Abstract, dependency: Abstract, implementation: any): void {
    this.contextualBindings.set(this.getAlias(consumer), this.getAlias(dependency), implementation);
  }

  /**
   * The contextual implementation registered for a dependency while the
   * current build-stack consumer is being built. Internal - used by the
   * resolution pipeline and `DependencyResolver`.
   */
  findContextualBinding(dependency: Abstract): any {
    return this.contextualBindings.find(this.currentConsumer(), this.getAlias(dependency));
  }

  /**
   * Resolve a contextual implementation that is not a binding pipeline
   * member: closures run with the container, classes are built, and
   * literal values (including `null`) are passed through.
   */
  unwrapContextualImplementation(implementation: any): any {
    if (isClosure(implementation)) {
      return (implementation as (container: Container, parameters: ParameterOverrides) => any)(
        this,
        this.lastParameterOverride()
      );
    }

    if (typeof implementation === 'function') {
      return this.make(implementation);
    }

    return implementation;
  }

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------

  /**
   * Assign a set of tags to a set of bindings
   * Laravel: $app->tag(abstracts, tags)
   */
  tag(abstracts: Abstract | Abstract[], tags: string | string[]): void {
    const abstractList = Array.isArray(abstracts) ? abstracts : [abstracts];
    const tagList = Array.isArray(tags) ? tags : [tags];

    for (const tag of tagList) {
      this.registry.tag(tag, abstractList);
    }
  }

  /**
   * Resolve every binding registered under a tag. An optional resolver
   * receives each abstract and the container, letting callers wrap or
   * substitute individual members (Laravel's `tagged($tag, $resolver)`).
   */
  tagged<T = any>(tag: string, resolver?: TagResolver): T[] {
    const abstracts = this.registry.tagged(tag);

    if (!abstracts) {
      return [];
    }

    const resolve: TagResolver = resolver ?? ((abstract, container) => container.make(abstract));

    return abstracts.map((abstract) => resolve(abstract, this) as T);
  }

  // -------------------------------------------------------------------------
  // Resolution
  // -------------------------------------------------------------------------

  /**
   * Resolve the given type from the container
   * Laravel: $app->make(abstract, parameters)
   */
  make<T>(abstract: Abstract, parameters: ParameterOverrides = []): T {
    abstract = this.getAlias(abstract);

    const contextual = this.findContextualBinding(abstract);
    const needsFreshBuild = hasNamedOverrides(parameters) || contextual !== undefined;

    if (!needsFreshBuild && this.registry.hasInstance(abstract)) {
      return this.registry.getInstance(abstract);
    }

    this.parameterOverrides.push(parameters);

    try {
      const concrete = contextual ?? this.getConcrete(abstract);

      let object: T = this.isBuildable(concrete, abstract)
        ? this.buildConcrete<T>(concrete)
        : this.make<T>(concrete as Abstract, parameters);

      object = this.hooks.applyExtenders(abstract, object, this) as T;

      if (this.isShared(abstract) && !needsFreshBuild) {
        this.registry.setInstance(abstract, object);
      }

      this.hooks.fireResolvingCallbacks(abstract, object, this);

      if (!needsFreshBuild) {
        this.registry.markResolved(abstract);
      }

      return object;
    } finally {
      this.parameterOverrides.pop();
    }
  }

  /**
   * Resolve the given type with named parameter overrides:
   * `makeWith(ReportService, { threshold: 10 })`. Positional arrays work
   * too, exactly like `make`.
   * Laravel: $app->makeWith(abstract, parameters)
   */
  makeWith<T>(abstract: Abstract, parameters: ParameterOverrides = {}): T {
    return this.make<T>(abstract, parameters);
  }

  /**
   * Instantiate a concrete instance of the given type, optionally with
   * parameter overrides scoped to this build.
   * Laravel: $app->build(concrete)
   */
  build<T>(concrete: Concrete<T>, parameters: ParameterOverrides = []): T {
    this.parameterOverrides.push(parameters);

    try {
      return this.buildConcrete<T>(concrete);
    } finally {
      this.parameterOverrides.pop();
    }
  }

  /**
   * Get a closure that resolves the given type from the container each
   * time it is invoked. Laravel: $app->factory(abstract)
   */
  factory<T>(abstract: Abstract): () => T {
    return () => this.make<T>(abstract);
  }

  /**
   * Wrap a closure so its dependencies are injected when it runs.
   * Laravel: $app->wrap(closure)
   */
  wrap<T>(callback: CallableArgument, parameters: ParameterOverrides = {}): () => T {
    return () => this.call<T>(callback, parameters);
  }

  // -------------------------------------------------------------------------
  // Callable invocation
  // -------------------------------------------------------------------------

  /**
   * Call the given closure / class@method and inject its dependencies.
   *
   * Accepts closures, `[Class|instance, 'method']`, `'Class@method'`,
   * class strings (invoked through `__invoke` or `defaultMethod`), and
   * objects exposing `__invoke`. Parameters are honoured first by
   * explicit override (positional array or named record), then by type
   * through the container - where contextual bindings apply because the
   * target class is pushed onto the build stack - and finally by default
   * values for nullable/unresolvable arguments.
   * Laravel: $app->call(callback, parameters, defaultMethod)
   */
  call<T = any>(callback: CallableArgument, parameters: ParameterOverrides = [], defaultMethod?: string): T {
    const resolved = CallableResolver.normalize(callback, this, defaultMethod);

    let pushed = false;

    if (resolved.consumer !== undefined && !this.buildStack.includes(resolved.consumer)) {
      this.buildStack.push(resolved.consumer);
      pushed = true;
    }

    try {
      const args = this.dependencies.resolveArguments(resolved.descriptors, parameters, resolved.label);

      return resolved.callback.apply(resolved.target, args) as T;
    } finally {
      if (pushed) {
        this.buildStack.pop();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Instance lifecycle
  // -------------------------------------------------------------------------

  /**
   * Remove a resolved instance from the instance cache
   * Laravel: $app->forgetInstance(abstract)
   */
  forgetInstance(abstract: Abstract): void {
    this.registry.deleteInstance(abstract);
  }

  /**
   * Clear all of the instances from the container
   * Laravel: $app->forgetInstances()
   */
  forgetInstances(): void {
    this.registry.clearInstances();
  }

  /**
   * Clear the instances of every `scoped()` binding, starting a fresh
   * scope (per-request in the HTTP kernel, per-test-case in TestCase).
   * Laravel: $app->forgetScopedInstances()
   */
  forgetScopedInstances(): void {
    for (const abstract of this.registry.scopedAbstracts()) {
      this.registry.deleteInstance(abstract);
    }
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  /**
   * Determine if the given abstract type has been bound
   */
  bound(abstract: Abstract): boolean {
    return this.registry.isBound(abstract);
  }

  /**
   * Determine if the given abstract type has been resolved
   */
  resolved(abstract: Abstract): boolean {
    abstract = this.getAlias(abstract);

    return this.registry.isResolved(abstract);
  }

  /**
   * Get the alias for an abstract if available
   */
  getAlias(abstract: Abstract): Abstract {
    return this.registry.getAlias(abstract);
  }

  /**
   * The concretion the container is currently building, for contextual
   * binding lookups (Laravel: $app->currentlyResolving())
   */
  currentlyResolving(): Abstract | undefined {
    return this.currentConsumer();
  }

  /**
   * Flush the container of all bindings and resolved instances
   */
  flush(): void {
    this.registry.flush();
  }

  // -------------------------------------------------------------------------
  // Resolution pipeline internals
  // -------------------------------------------------------------------------

  /**
   * Instantiate the concrete registered for an abstract: factory
   * closures receive the container and the active parameter overrides,
   * classes go through the shared injection pipeline with themselves on
   * the build stack so their dependencies can see contextual bindings.
   */
  private buildConcrete<T>(concrete: Concrete<T>): T {
    if (isClosure(concrete)) {
      return (concrete as (container: Container, parameters: ParameterOverrides) => T)(
        this,
        this.lastParameterOverride()
      );
    }

    if (typeof concrete === 'function') {
      this.buildStack.push(concrete);

      let args: any[];

      try {
        args = this.dependencies.resolveArguments(
          ParameterReflector.parametersOf(concrete),
          this.lastParameterOverride(),
          concrete.name
        );
      } finally {
        this.buildStack.pop();
      }

      return new (concrete as new (...args: any[]) => T)(...args);
    }

    throw new Error(`Target [${String(concrete)}] is not instantiable.`);
  }

  /**
   * Get the concrete type for a given abstract
   */
  private getConcrete(abstract: Abstract): Concrete {
    const binding = this.registry.getBinding(abstract);

    if (binding) {
      return binding.concrete;
    }

    // If no binding exists, assume the abstract is the concrete
    return abstract as Concrete;
  }

  /**
   * Determine if the given concrete is buildable
   */
  private isBuildable(concrete: Concrete, abstract: Abstract): boolean {
    return concrete === abstract || typeof concrete === 'function';
  }

  /**
   * Determine if a given type is shared
   */
  private isShared(abstract: Abstract): boolean {
    const binding = this.registry.getBinding(abstract);

    return binding ? binding.shared : false;
  }

  private currentConsumer(): Abstract | undefined {
    return this.buildStack.length > 0 ? this.buildStack[this.buildStack.length - 1] : undefined;
  }

  private lastParameterOverride(): ParameterOverrides {
    return this.parameterOverrides.length > 0 ? this.parameterOverrides[this.parameterOverrides.length - 1] : [];
  }

  /**
   * Refresh the bound callbacks for an abstract with its current
   * instance (Laravel's `rebound`).
   */
  private fireRebound(abstract: Abstract): void {
    const callbacks = this.hooks.reboundCallbacksFor(this.getAlias(abstract));

    if (callbacks.length === 0) {
      return;
    }

    const instance = this.make(abstract);

    for (const callback of callbacks) {
      callback(this, instance);
    }
  }
}
