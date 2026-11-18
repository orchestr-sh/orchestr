/**
 * Hashed cast
 *
 * `hashed` runs a value through the application hasher on write, so the
 * column stores a hash rather than the secret itself, and refuses to hash a
 * value that is already a hash - re-saving a loaded model must not salt its
 * own output again. Reads hand back the stored hash: hashing does not
 * invert.
 *
 * Laravel: HasAttributes::castAttributeAsHashedString()
 */

import type { CastsAttributes } from '@/Database/Contracts/CastsAttributes';
import type { Hasher } from '@/Hashing/Contracts/Hasher';

export class HashedCast implements CastsAttributes {
  get(_model: any, _key: string, value: any): any {
    return value;
  }

  set(model: any, _key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    const hasher = this.hasher(model);

    if (typeof value === 'string' && hasher.info(value) !== null) {
      return value;
    }

    return hasher.make(String(value));
  }

  protected hasher(model: any): Hasher {
    return model.hasher();
  }
}
