/**
 * AsStringable cast
 *
 * The column value is handed back as a fluent `Stringable`, and written back
 * as the plain string it wraps - the Laravel `AsStringable` cast.
 */

import type { CastsAttributes } from '@/Database/Contracts/CastsAttributes';
import { Stringable } from '@/Support/Stringable';

export class AsStringable implements CastsAttributes {
  get(_model: any, _key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    return Stringable.of(value);
  }

  set(_model: any, _key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    return value instanceof Stringable ? value.toString() : String(value);
  }

  serialize(_model: any, _key: string, value: any): any {
    return value instanceof Stringable ? value.toString() : value;
  }
}
