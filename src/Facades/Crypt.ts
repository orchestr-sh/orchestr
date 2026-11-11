/**
 * Crypt Facade
 *
 * Provides static access to the application encrypter.
 *
 * @example
 * ```typescript
 * import { Crypt } from '@orchestr-sh/orchestr';
 *
 * const payload = Crypt.encrypt({ a: 1 });
 * Crypt.decrypt(payload); // { a: 1 }
 *
 * Crypt.decryptString(Crypt.encryptString('secret')); // 'secret'
 * ```
 */

import type { Encrypter as EncrypterClass } from '@/Encryption/Encrypter';
import { Facade } from '@/Support/Facade';

class CryptFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'encrypter';
  }
}

export const Crypt = new Proxy(CryptFacadeClass, {
  get(target, prop) {
    // First check if it's a static method on the facade class itself
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    // Then proxy to the encrypter instance
    try {
      const root = (target as any).getFacadeRoot() as EncrypterClass;
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
}) as unknown as typeof CryptFacadeClass & EncrypterClass;
