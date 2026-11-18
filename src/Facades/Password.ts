/**
 * Password Facade
 *
 * Provides static access to the PasswordBrokerManager bound under
 * `auth.password` by the PasswordResetServiceProvider: broker resolution
 * plus the default broker's reset API (the manager forwards
 * sendResetLink/reset/validateToken/deleteToken, like Laravel's
 * PasswordBrokerManager::__call()).
 *
 * @example
 * ```typescript
 * import { Password } from '@orchestr-sh/orchestr';
 *
 * const status = await Password.sendResetLink({ email: 'ada@example.com' });
 * if (status !== PasswordBroker.RESET_LINK_SENT) {
 *   // INVALID_USER | RESET_THROTTLED
 * }
 *
 * await Password.reset({ email, token, password: 'new-secret' });
 * await Password.broker('admin').deleteToken({ email });
 *
 * // Register a custom token repository driver (OCP)
 * Password.extend('cache', (name, config, manager) => new CacheTokenRepository(...));
 * ```
 */

import type { PasswordBrokerManager } from '@/Auth/Passwords/PasswordBrokerManager';
import { Facade } from '@/Support/Facade';

class PasswordFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'auth.password';
  }
}

export const Password = new Proxy(PasswordFacadeClass, {
  get(target, prop) {
    // First check if it's a static method on the facade class itself
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    // Then proxy to the broker manager, which forwards the broker API to
    // the default broker
    try {
      const root = (target as any).getFacadeRoot() as PasswordBrokerManager;
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
}) as unknown as typeof PasswordFacadeClass & PasswordBrokerManager;
