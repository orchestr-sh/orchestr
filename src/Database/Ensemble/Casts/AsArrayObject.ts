/**
 * AsArrayObject cast
 *
 * The stored JSON becomes an `ArrayObject` with array semantics, and the
 * ArrayObject travels back into the column as JSON on write.
 *
 * Laravel: Illuminate\Database\Eloquent\Casts\AsArrayObject
 */

import type { CastsAttributes } from '@/Database/Contracts/CastsAttributes';
import { ArrayObject } from './ArrayObject';

export class AsArrayObject implements CastsAttributes {
  get(_model: any, _key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (value instanceof ArrayObject) {
      return value;
    }

    return new ArrayObject(typeof value === 'string' ? JSON.parse(value) : value);
  }

  set(_model: any, _key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    const data = value instanceof ArrayObject ? value.getArrayCopy() : value;

    return typeof data === 'string' ? data : JSON.stringify(data);
  }

  serialize(_model: any, _key: string, value: any): any {
    return value instanceof ArrayObject ? value.getArrayCopy() : value;
  }
}
