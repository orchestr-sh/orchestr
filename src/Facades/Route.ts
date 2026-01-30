import { Facade } from '../Support/Facade';
import { Router } from '../Routing/Router';

/**
 * Route Facade - Static access to the Router
 * Usage: Route.get('/path', handler)
 */
class RouteFacade extends Facade {
  protected static getFacadeAccessor(): string {
    return 'router';
  }

  static get: Router['get'];
  static post: Router['post'];
  static put: Router['put'];
  static patch: Router['patch'];
  static delete: Router['delete'];
  static any: Router['any'];
  static match: Router['match'];
  static group: Router['group'];
}

// Create proxy to enable static method calls
export const Route = new Proxy(RouteFacade, {
  get(target, prop) {
    // First try to get from the facade root (the actual Router instance)
    try {
      const root = (target as any).getFacadeRoot();
      if (root && prop in root) {
        const value = root[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(root, args);
        }
        return value;
      }
    } catch (error) {
      // Facade root not available yet, fall through
    }

    // Fall back to static properties/methods of the Facade class itself
    if (typeof prop === 'string' && prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    return undefined;
  }
}) as unknown as typeof RouteFacade & Router;
