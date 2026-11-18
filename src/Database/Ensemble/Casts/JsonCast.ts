/**
 * JSON casts
 *
 * `array`, `json` and `object` all store a serialized string and hand back
 * the parsed value. Writes that arrive as objects are serialized right away,
 * so the attributes - and therefore the database bindings - always hold the
 * string form.
 *
 * Laravel: HasAttributes::castAttributeAsJson()
 */

import type { CastsAttributes } from '@/Database/Contracts/CastsAttributes';

export class JsonCast implements CastsAttributes {
  get(_model: any, key: string, value: any): any {
    if (typeof value !== 'string') {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`The attribute [${key}] does not contain valid JSON.`);
    }
  }

  set(_model: any, _key: string, value: any): any {
    if (value === null || value === undefined || typeof value === 'string') {
      return value;
    }

    return JSON.stringify(value);
  }
}
