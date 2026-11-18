/**
 * AsEnumCollection cast
 *
 * A JSON array whose every item is mapped onto a TypeScript enum member, the
 * Laravel `AsEnumCollection`. Reads hand back a `Collection` of enum values;
 * writes store the member values as JSON.
 */

import type { CastsAttributes } from '@/Database/Contracts/CastsAttributes';
import { Collection } from '@/Support/Collection';
import type { EnumLike } from './CastRegistry';
import { resolveEnumMember } from './EnumCast';

export class AsEnumCollection implements CastsAttributes {
  constructor(protected enumObject: EnumLike) {}

  /**
   * Bind the collection cast to an enum object.
   */
  static of(enumObject: EnumLike): AsEnumCollection {
    return new AsEnumCollection(enumObject);
  }

  get(_model: any, key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    const items = typeof value === 'string' ? JSON.parse(value) : value;
    const list = Array.isArray(items) ? items : Object.values(items ?? {});

    return new Collection(list.map((item) => resolveEnumMember(this.enumObject, item, key)));
  }

  set(_model: any, key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    const items = value instanceof Collection ? value.all() : Array.isArray(value) ? value : Object.values(value);

    return JSON.stringify(items.map((item) => resolveEnumMember(this.enumObject, item, key)));
  }

  serialize(_model: any, _key: string, value: any): any {
    return value instanceof Collection ? value.toArray() : value;
  }
}
