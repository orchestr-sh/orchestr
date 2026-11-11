/**
 * Hash Facade
 *
 * Provides static access to the hashing manager and, through it, the
 * default hasher driver.
 *
 * @example
 * ```typescript
 * import { Hash } from '@orchestr-sh/orchestr';
 *
 * const hashed = Hash.make('secret');
 * Hash.check('secret', hashed); // true
 *
 * if (Hash.needsRehash(hashed)) {
 *   // rehash with the current cost and persist it
 * }
 *
 * Hash.driver('argon2').make('secret'); // switch drivers per call
 * ```
 */

import type { HashManager } from '@/Hashing/HashManager';
import { Facade } from '@/Support/Facade';

class HashFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'hash';
  }
}

export const Hash = new Proxy(HashFacadeClass, {
  get(target, prop) {
    // First check if it's a static method on the facade class itself
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    // Then proxy to the manager, which forwards make/check/needsRehash/
    // verifyConfiguration to the default driver
    try {
      const root = (target as any).getFacadeRoot() as HashManager;
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
}) as unknown as typeof HashFacadeClass & HashManager;
