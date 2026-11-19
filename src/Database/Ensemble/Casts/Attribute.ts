/**
 * Attribute
 *
 * The modern accessor/mutator object, the equivalent of Laravel's
 * Illuminate\Database\Eloquent\Casts\Attribute. A model hands one back from
 * a camelCase method named after the column (`firstName()` for
 * `first_name`), or stores it in a same-named property:
 *
 * ```typescript
 * class User extends Ensemble {
 *   protected firstName(): Attribute {
 *     return Attribute.make(
 *       (value) => value.toUpperCase(),
 *       (value) => value.toLowerCase()
 *     );
 *   }
 * }
 * ```
 *
 * Either the callbacks or an options object are accepted, mirroring
 * `Attribute::make(get: ..., set: ...)`.
 */

export type AttributeGetCallback = (value: any, attributes: Record<string, any>) => any;
export type AttributeSetCallback = (value: any, attributes: Record<string, any>) => any;

export interface AttributeOptions {
  get?: AttributeGetCallback;
  set?: AttributeSetCallback;
}

export class Attribute {
  constructor(
    public readonly get?: AttributeGetCallback,
    public readonly set?: AttributeSetCallback
  ) {}

  static make(options: AttributeOptions): Attribute;
  static make(get?: AttributeGetCallback, set?: AttributeSetCallback): Attribute;
  static make(getOrOptions?: AttributeGetCallback | AttributeOptions, set?: AttributeSetCallback): Attribute {
    if (typeof getOrOptions === 'function' || getOrOptions === undefined) {
      return new Attribute(getOrOptions, set);
    }

    return new Attribute(getOrOptions.get, getOrOptions.set);
  }
}
