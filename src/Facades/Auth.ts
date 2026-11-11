/**
 * Auth Facade
 *
 * Provides static access to the auth manager: guard resolution, custom
 * guard registration and the default guard's authentication API.
 *
 * @example
 * ```typescript
 * import { Auth } from '@orchestr-sh/orchestr';
 *
 * await Auth.attempt({ email: 'ada@example.com', password: 'secret' }, true);
 * const user = await Auth.user();
 * await Auth.logout();
 *
 * // Switch guards per call
 * await Auth.guard('token').check();
 *
 * // Register a custom guard driver (OCP)
 * Auth.extend('basic', (name, config, manager) => new BasicGuard(name, manager.provider(config.provider)));
 * ```
 */

import type { AuthManager } from '@/Auth/AuthManager';
import { Facade } from '@/Support/Facade';

class AuthFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'auth';
  }
}

export const Auth = new Proxy(AuthFacadeClass, {
  get(target, prop) {
    // First check if it's a static method on the facade class itself
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    // Then proxy to the manager, which forwards user/attempt/login/logout
    // and the rest to the default guard
    try {
      const root = (target as any).getFacadeRoot() as AuthManager;
      if (root && prop in root) {
        const value = (root as any)[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(root, args);
        }
        return value;
      }
    } catch (error) {
      // Facade root not available yet
    }

    return undefined;
  },
}) as unknown as typeof AuthFacadeClass & AuthManager;
