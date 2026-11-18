/**
 * Cast Registry
 *
 * The single place cast strings are turned into cast objects, so
 * `getAttribute()`, `toObject()` and persistence always agree on what a cast
 * means (DRY). Built-in names register here at module load; applications add
 * their own with `CastRegistry.register('jwt', JwtCast)` and use them without
 * touching a switch somewhere else (OCP).
 *
 * A casts-map entry may be:
 *   - a string: `'int'`, `'decimal:2'`, `'enum:Status'`, `'date:Y-m-d'`, or
 *     any registered name
 *   - a `CastsAttributes` class: `{ x: MyCast }`
 *   - a `CastsAttributes` instance: `{ x: new MyCast('arg') }`
 *   - an arguments object: `{ class: MyCast, arguments: ['a'] }`
 *   - a TypeScript enum object: `{ x: Status }`
 *
 * Laravel: Illuminate\Database\Eloquent\Concerns\HasCasts (resolution half);
 * the class-string mapping Laravel gets from the container it gets here from
 * an explicit registry, which TypeScript cannot derive from a name alone.
 */

import type { CastsAttributes } from '@/Database/Contracts/CastsAttributes';
import { EnumCast } from './EnumCast';

/** A cast class, the way Laravel names cast classes in a $casts map. */
export type CastClass = new (...args: any[]) => CastsAttributes;

/** Produces a cast instance from the arguments parsed out of a cast string. */
export type CastFactory = (args: any[]) => CastsAttributes;

/** A TypeScript enum object, as produced by `enum Status { ... }`. */
export type EnumLike = Record<string, string | number>;

/** The Laravel `['class' => ..., 'arguments' => [...]]` cast form. */
export interface CastArgumentsForm {
  class: CastClass | string;
  arguments?: any[];
}

/** Anything a casts map may name as a cast. */
export type CastDefinition = string | CastClass | CastsAttributes | EnumLike | CastArgumentsForm;

function isCastClass(value: CastFactory | CastClass): value is CastClass {
  return typeof value === 'function' && typeof (value as CastClass).prototype?.get === 'function';
}

export class CastRegistry {
  /** Registered cast names: built-ins and application casts alike. */
  private static factories = new Map<string, CastFactory>();

  /** Names registered as classes, kept for the reverse `nameFor()` lookup. */
  private static classes = new Map<string, CastClass>();

  /** Enum objects registered by name so `'enum:Status'` can resolve. */
  private static enums = new Map<string, EnumLike>();

  /** One instance per distinct cast string: resolution never re-builds. */
  private static stringCache = new Map<string, CastsAttributes>();

  /** One instance per cast class used directly in a casts map. */
  private static classCache = new WeakMap<CastClass, CastsAttributes>();

  /** One enum cast per enum object used directly in a casts map. */
  private static enumCache = new WeakMap<EnumLike, CastsAttributes>();

  /**
   * Register a cast under a name usable in a casts map.
   *
   * Classes are instantiated with the string arguments (`'name:arg1,arg2'`),
   * factories receive the parsed argument list; both are cached by the full
   * cast string, so a name resolves once per application.
   */
  static register(name: string, cast: CastFactory | CastClass): void {
    if (isCastClass(cast)) {
      const castClass = cast;
      CastRegistry.factories.set(name, (args: any[]) => new castClass(...args));
      CastRegistry.classes.set(name, castClass);
    } else {
      CastRegistry.factories.set(name, cast);
    }

    CastRegistry.stringCache.clear();
  }

  /**
   * Register a TypeScript enum object under a name, making
   * `'enum:Name'` (and `'AsEnumCollection:Name'`) resolvable.
   */
  static registerEnum(name: string, enumObject: EnumLike): void {
    CastRegistry.enums.set(name, enumObject);
    CastRegistry.stringCache.clear();
  }

  /**
   * Remove a registered cast or enum name, mostly for test isolation.
   */
  static unregister(name: string): void {
    CastRegistry.factories.delete(name);
    CastRegistry.classes.delete(name);
    CastRegistry.enums.delete(name);
    CastRegistry.stringCache.clear();
  }

  /**
   * Whether a name is registered as a cast.
   */
  static has(name: string): boolean {
    return CastRegistry.factories.has(name);
  }

  /**
   * The enum object registered under a name, or undefined.
   */
  static getEnum(name: string): EnumLike | undefined {
    return CastRegistry.enums.get(name);
  }

  /**
   * Resolve a casts-map entry to the cast object that runs it.
   *
   * Unknown names resolve to nothing rather than throwing: a stray entry in
   * a map should leave the attribute untouched, the way Laravel's switch
   * falls through to the raw value.
   */
  static resolve(entry: CastDefinition | undefined | null): CastsAttributes | undefined {
    if (entry === undefined || entry === null) {
      return undefined;
    }

    if (typeof entry === 'string') {
      return CastRegistry.resolveString(entry);
    }

    if (typeof entry === 'function') {
      return CastRegistry.instantiateClass(entry as CastClass, []);
    }

    const candidate = entry as Partial<CastArgumentsForm> & Partial<CastsAttributes>;

    if (typeof candidate.get === 'function' && typeof candidate.set === 'function') {
      return candidate as CastsAttributes;
    }

    if ('class' in candidate && candidate.class !== undefined) {
      return CastRegistry.resolveArgumentsForm(candidate as CastArgumentsForm);
    }

    return CastRegistry.enumCast(entry as EnumLike);
  }

  /**
   * Resolve `'enum:Name'` / `'AsEnumCollection:Name'` argument entries.
   */
  static requireEnum(name: string): EnumLike {
    const enumObject = CastRegistry.enums.get(name);

    if (!enumObject) {
      throw new Error(
        `The enum [${name}] is not registered. Call CastRegistry.registerEnum('${name}', ${name}) ` +
          `before using it in a cast.`
      );
    }

    return enumObject;
  }

  /**
   * The canonical string form of a casts-map entry, used by
   * `ensureCastsAreStringValues()`. Objects that were never registered have
   * no name to travel under and report themselves instead.
   */
  static nameFor(entry: CastDefinition): string {
    if (typeof entry === 'string') {
      return entry;
    }

    if (typeof entry === 'function') {
      return CastRegistry.classNameFor(entry as CastClass);
    }

    const candidate = entry as Partial<CastArgumentsForm> & Partial<CastsAttributes>;

    if (typeof candidate.get === 'function' && typeof candidate.set === 'function') {
      return CastRegistry.classNameFor((entry as CastsAttributes).constructor as CastClass);
    }

    if ('class' in candidate && candidate.class !== undefined) {
      const name = typeof candidate.class === 'string' ? candidate.class : CastRegistry.classNameFor(candidate.class);

      return candidate.arguments && candidate.arguments.length > 0 ? `${name}:${candidate.arguments.join(',')}` : name;
    }

    for (const [name, enumObject] of CastRegistry.enums) {
      if (enumObject === entry) {
        return `enum:${name}`;
      }
    }

    throw new Error(
      `The cast [${describeObject(entry)}] must be registered with CastRegistry.register() ` +
        `or CastRegistry.registerEnum() to be used as a string value.`
    );
  }

  /**
   * Drop every cached cast instance; the built-in registrations stay.
   */
  static flushCache(): void {
    CastRegistry.stringCache.clear();
  }

  private static resolveString(value: string): CastsAttributes | undefined {
    const cached = CastRegistry.stringCache.get(value);

    if (cached) {
      return cached;
    }

    const separator = value.indexOf(':');
    const base = separator === -1 ? value : value.slice(0, separator);
    const argumentText = separator === -1 ? '' : value.slice(separator + 1);
    const args = argumentText === '' ? [] : argumentText.split(',');

    const factory = CastRegistry.factories.get(base);

    if (!factory) {
      return undefined;
    }

    const instance = factory(args);
    CastRegistry.stringCache.set(value, instance);

    return instance;
  }

  private static resolveArgumentsForm(form: CastArgumentsForm): CastsAttributes {
    const args = form.arguments ?? [];

    if (typeof form.class === 'string') {
      const factory = CastRegistry.factories.get(form.class);

      if (!factory) {
        throw new Error(`The cast class [${form.class}] is not registered with CastRegistry.register().`);
      }

      return factory(args);
    }

    return new form.class(...args);
  }

  private static instantiateClass(castClass: CastClass, args: any[]): CastsAttributes {
    let cast = CastRegistry.classCache.get(castClass);

    if (!cast) {
      cast = new castClass(...args);
      CastRegistry.classCache.set(castClass, cast);
    }

    return cast;
  }

  private static enumCast(enumObject: EnumLike): CastsAttributes {
    let cast = CastRegistry.enumCache.get(enumObject);

    if (!cast) {
      cast = new EnumCast(enumObject);
      CastRegistry.enumCache.set(enumObject, cast);
    }

    return cast;
  }

  private static classNameFor(castClass: CastClass): string {
    for (const [name, registered] of CastRegistry.classes) {
      if (registered === castClass) {
        return name;
      }
    }

    throw new Error(
      `The cast class [${castClass.name}] must be registered with CastRegistry.register() ` +
        `to be used as a string value.`
    );
  }
}

function describeObject(value: object): string {
  const name = (value as { constructor?: { name?: string } }).constructor?.name;

  return name && name !== 'Object' ? name : JSON.stringify(Object.keys(value));
}
