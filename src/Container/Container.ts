import 'reflect-metadata';

export type Abstract = string | symbol | Function;
export type Concrete<T = any> = ((container: Container) => T) | (new (...args: any[]) => T);
export type Binding = {
  concrete: Concrete;
  shared: boolean;
};

/**
 * Service Container - Laravel's IoC Container
 * Handles dependency injection and service resolution
 */
export class Container {
  private bindings: Map<Abstract, Binding> = new Map();
  private instances: Map<Abstract, any> = new Map();
  private aliases: Map<Abstract, Abstract> = new Map();
  private resolvedTypes: Map<Abstract, boolean> = new Map();

  /**
   * Register a binding with the container
   * Laravel: $app->bind(abstract, concrete)
   */
  bind<T>(abstract: Abstract, concrete: Concrete<T> | null = null, shared: boolean = false): void {
    if (concrete === null) {
      concrete = abstract as Concrete<T>;
    }

    this.bindings.set(abstract, { concrete, shared });

    // If already resolved and not shared, clear the instance
    if (this.resolvedTypes.has(abstract) && !shared) {
      this.instances.delete(abstract);
      this.resolvedTypes.delete(abstract);
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
   * Register an existing instance as shared in the container
   * Laravel: $app->instance(abstract, instance)
   */
  instance<T>(abstract: Abstract, instance: T): T {
    this.instances.set(abstract, instance);
    this.bindings.set(abstract, {
      concrete: () => instance,
      shared: true,
    });
    return instance;
  }

  /**
   * Alias a type to a different name
   * Laravel: $app->alias(abstract, alias)
   */
  alias(abstract: Abstract, alias: Abstract): void {
    this.aliases.set(alias, abstract);
  }

  /**
   * Resolve the given type from the container
   * Laravel: $app->make(abstract)
   */
  make<T>(abstract: Abstract, parameters: any[] = []): T {
    return this.resolve(abstract, parameters);
  }

  /**
   * Resolve the given type from the container
   */
  private resolve<T>(abstract: Abstract, parameters: any[] = []): T {
    // Get the real abstract if this is an alias
    abstract = this.getAlias(abstract);

    // If we have a shared instance, return it
    if (this.instances.has(abstract)) {
      return this.instances.get(abstract);
    }

    // Get the concrete implementation
    const concrete = this.getConcrete(abstract);

    // Build the concrete type
    let object: T;

    if (this.isBuildable(concrete, abstract)) {
      object = this.build(concrete, parameters);
    } else {
      object = this.make(concrete as Abstract, parameters);
    }

    // If the binding is shared, store the instance
    if (this.isShared(abstract)) {
      this.instances.set(abstract, object);
    }

    this.resolvedTypes.set(abstract, true);

    return object;
  }

  /**
   * Get the concrete type for a given abstract
   */
  private getConcrete(abstract: Abstract): Concrete {
    const binding = this.bindings.get(abstract);

    if (binding) {
      return binding.concrete;
    }

    // If no binding exists, assume the abstract is the concrete
    return abstract as Concrete;
  }

  /**
   * Get the alias for an abstract if available
   */
  private getAlias(abstract: Abstract): Abstract {
    return this.aliases.has(abstract) ? this.getAlias(this.aliases.get(abstract)!) : abstract;
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
    const binding = this.bindings.get(abstract);
    return binding ? binding.shared : false;
  }

  /**
   * Instantiate a concrete instance of the given type
   * Uses reflection to resolve constructor dependencies
   */
  private build<T>(concrete: Concrete<T>, parameters: any[] = []): T {
    // If concrete is a function (factory), call it
    if (typeof concrete === 'function' && concrete.prototype === undefined) {
      return (concrete as Function)(this);
    }

    // If concrete is a class, use reflection to get dependencies
    if (typeof concrete === 'function') {
      const dependencies = this.resolveDependencies(concrete, parameters);
      return new (concrete as new (...args: any[]) => T)(...dependencies);
    }

    throw new Error(`Target [${String(concrete)}] is not instantiable.`);
  }

  /**
   * Resolve all dependencies for a class constructor
   * Uses TypeScript's reflect-metadata to get parameter types
   */
  private resolveDependencies(concrete: Function, parameters: any[] = []): any[] {
    const paramTypes = Reflect.getMetadata('design:paramtypes', concrete) || [];

    return paramTypes.map((paramType: any, index: number) => {
      // If parameter was provided explicitly, use it
      if (parameters[index] !== undefined) {
        return parameters[index];
      }

      // If no type information, throw error
      if (!paramType || paramType === Object) {
        throw new Error(
          `Cannot resolve dependency at position ${index} for ${concrete.name}. ` +
            `Make sure TypeScript decorators are enabled and the class has proper type hints.`
        );
      }

      // Resolve the dependency from the container
      return this.make(paramType);
    });
  }

  /**
   * Determine if the given abstract type has been bound
   */
  bound(abstract: Abstract): boolean {
    return this.bindings.has(abstract) || this.instances.has(abstract) || this.aliases.has(abstract);
  }

  /**
   * Determine if the given abstract type has been resolved
   */
  resolved(abstract: Abstract): boolean {
    abstract = this.getAlias(abstract);
    return this.resolvedTypes.has(abstract) || this.instances.has(abstract);
  }

  /**
   * Flush the container of all bindings and resolved instances
   */
  flush(): void {
    this.bindings.clear();
    this.instances.clear();
    this.aliases.clear();
    this.resolvedTypes.clear();
  }

  /**
   * Call the given Closure / class@method and inject its dependencies
   * Laravel: $app->call(callable)
   */
  call(callback: Function, parameters: any[] = []): any {
    const paramTypes = Reflect.getMetadata('design:paramtypes', callback) || [];
    const dependencies = paramTypes.map((paramType: any, index: number) => {
      if (parameters[index] !== undefined) {
        return parameters[index];
      }
      return this.make(paramType);
    });

    return callback(...dependencies);
  }
}
