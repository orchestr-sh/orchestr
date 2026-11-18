/**
 * Scalar casts
 *
 * The primitive cast types: they shape what a read hands back while letting
 * writes store the value untouched, exactly where Laravel's `int`/`float`/
 * `string`/`boolean` entries in the cast switch live. Registered by name, so
 * `getAttribute`, dirty comparison and persistence all read them through the
 * same object.
 *
 * Laravel: HasAttributes::$primitiveCastTypes
 */

import type { CastsAttributes } from '@/Database/Contracts/CastsAttributes';

/**
 * Casts to an integer.
 * Laravel: castAttribute() 'integer' case
 */
export class IntCast implements CastsAttributes {
  get(_model: any, _key: string, value: any): any {
    return parseInt(value, 10);
  }

  set(_model: any, _key: string, value: any): any {
    return value;
  }
}

/**
 * Casts to a floating point number.
 * Laravel: castAttribute() 'real' case
 */
export class FloatCast implements CastsAttributes {
  get(_model: any, _key: string, value: any): any {
    return parseFloat(value);
  }

  set(_model: any, _key: string, value: any): any {
    return value;
  }
}

/**
 * Casts to a string.
 * Laravel: castAttribute() 'string' case
 */
export class StringCast implements CastsAttributes {
  get(_model: any, _key: string, value: any): any {
    return String(value);
  }

  set(_model: any, _key: string, value: any): any {
    return value;
  }
}

/**
 * Casts to a boolean.
 * Laravel: castAttribute() 'boolean' case
 */
export class BoolCast implements CastsAttributes {
  get(_model: any, _key: string, value: any): any {
    return Boolean(value);
  }

  set(_model: any, _key: string, value: any): any {
    return value;
  }
}
