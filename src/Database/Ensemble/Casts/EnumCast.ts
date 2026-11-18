/**
 * Enum cast
 *
 * `enum:Status` maps a stored column value onto a TypeScript enum member.
 * Reads hand back the member value (or accept the member name, which is how
 * a JSON payload can say `Shipped` for `Status.Shipped`); writes store the
 * member value, so the column never carries something the enum cannot name.
 *
 * Laravel: HasAttributes::castAttributeAsEnum()
 */

import type { CastsAttributes } from '@/Database/Contracts/CastsAttributes';
import type { EnumLike } from './CastRegistry';

/**
 * The declared member values of an enum, skipping the reverse `0 -> 'Name'`
 * keys TypeScript builds for numeric enums.
 */
export function enumMemberValues(enumObject: EnumLike): (string | number)[] {
  return Object.keys(enumObject)
    .filter((key) => Number.isNaN(Number(key)))
    .map((key) => enumObject[key]);
}

/**
 * Map a stored or supplied value onto its enum member value: an exact member
 * value, a member name, or a numeric string of a numeric enum. Anything else
 * is not part of the enum and says so.
 * Laravel: HasAttributes::castAttributeAsEnum()
 */
export function resolveEnumMember(enumObject: EnumLike, value: any, key: string): string | number {
  const members = enumMemberValues(enumObject);

  if (members.includes(value)) {
    return value;
  }

  if (typeof value === 'string') {
    // A member name, as opposed to the `0`/`1` reverse keys of numeric enums.
    if (Object.prototype.hasOwnProperty.call(enumObject, value) && Number.isNaN(Number(value))) {
      const named = enumObject[value];

      if (typeof named === 'string' || typeof named === 'number') {
        return named;
      }
    }

    if (members.includes(Number(value)) && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }

  throw new Error(`The attribute [${key}] cannot be cast to the enum: [${String(value)}] is not a member.`);
}

export class EnumCast implements CastsAttributes {
  constructor(protected enumObject: EnumLike) {}

  get(_model: any, key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    return resolveEnumMember(this.enumObject, value, key);
  }

  set(_model: any, key: string, value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    return resolveEnumMember(this.enumObject, value, key);
  }
}
