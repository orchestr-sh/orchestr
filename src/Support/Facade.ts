import { Application } from '../Foundation/Application';

/**
 * Facade - Laravel's Facade base class
 * Provides static proxy to underlying service in the container
 */
export abstract class Facade {
  private static app: Application;
  private static resolvedInstances: Map<string, any> = new Map();

  /**
   * Set the application instance for facades
   */
  static setFacadeApplication(app: Application): void {
    Facade.app = app;
  }

  /**
   * Get the application instance
   */
  static getFacadeApplication(): Application {
    return Facade.app;
  }

  /**
   * Get the registered name of the component
   * This should be overridden by child classes
   */
  protected static getFacadeAccessor(): string {
    throw new Error('Facade does not implement getFacadeAccessor method.');
  }

  /**
   * Resolve the facade root instance from the container
   */
  protected static resolveFacadeInstance(name: string): any {
    if (Facade.resolvedInstances.has(name)) {
      return Facade.resolvedInstances.get(name);
    }

    if (Facade.app) {
      const instance = Facade.app.make(name);
      Facade.resolvedInstances.set(name, instance);
      return instance;
    }

    throw new Error('A facade root has not been set.');
  }

  /**
   * Get the root object behind the facade
   */
  protected static getFacadeRoot(): any {
    return Facade.resolveFacadeInstance(this.getFacadeAccessor());
  }

  /**
   * Clear a resolved facade instance
   */
  static clearResolvedInstance(name: string): void {
    Facade.resolvedInstances.delete(name);
  }

  /**
   * Clear all resolved instances
   */
  static clearResolvedInstances(): void {
    Facade.resolvedInstances.clear();
  }
}

/**
 * Create a Facade class dynamically with proxy support
 * This allows calling methods statically: MyFacade.method()
 */
export function createFacade<T extends object>(accessor: string): new () => T {
  class DynamicFacade extends Facade {
    protected static getFacadeAccessor(): string {
      return accessor;
    }

    constructor() {
      super();
      return new Proxy(this, {
        get(target, prop, receiver) {
          const root = DynamicFacade.getFacadeRoot();
          if (root && typeof root[prop] === 'function') {
            return (...args: any[]) => root[prop](...args);
          }
          return root[prop];
        }
      });
    }
  }

  // Create a Proxy on the class itself for static method calls
  return new Proxy(DynamicFacade as any, {
    get(target, prop) {
      if (prop in target) {
        return target[prop];
      }

      const root = target.getFacadeRoot();
      if (root && typeof root[prop] === 'function') {
        return (...args: any[]) => root[prop](...args);
      }
      return root[prop];
    }
  });
}
