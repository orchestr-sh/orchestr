/**
 * Arr Class
 *
 * A TypeScript port of Illuminate\Support\Arr, the array / object helpers
 * that Laravel's Collection builds on. All methods are static and free of
 * framework / container dependencies so they are safe to use in any
 * context.
 *
 * Notes:
 * - "Arrays" are plain JavaScript arrays and "assoc arrays" are plain
 *   objects. Dot notation (e.g. 'products.0.name') traverses both, with
 *   numeric segments addressing array indexes.
 * - Wildcards ('*') are supported by `get`, `has`, `pluck` and the
 *   `data_get` / `data_set` global helpers, mirroring Laravel's
 *   data helpers.
 * - Missing paths return the given default (or `undefined`), matching
 *   Laravel's null-ish returns.
 */

import type { CollectionKey } from './Collection';
import { Collection } from './Collection';

export type ArrayLikeOrRecord<T = any> = T[] | Readonly<Record<string, T>> | Collection<T>;

/** Resolve a single segment-style key into its parts. */
function toSegments(key: CollectionKey): string[] {
  return String(key).split('.');
}

/** Own keys of an array / record / collection, numeric keys first (JS native ordering). */
function ownKeys(target: any): CollectionKey[] {
  return Object.keys(target).map(normalizeKey);
}

/** Own [key, value] entries of an array / record / collection. */
function ownEntries(target: any): Array<[CollectionKey, any]> {
  return ownKeys(target).map((key) => [key, target[key]] as [CollectionKey, any]);
}

/** Numeric-string keys become real numbers so array indexes behave like Laravel's. */
function normalizeKey(key: string): CollectionKey {
  if (/^(0|[1-9]\d*)$/.test(key)) {
    return Number(key);
  }

  return key;
}

/** Whether a value is a plain object record (not an array, Date, Map, class instance, ...). */
function isPlainRecord(value: any): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

/** Whether a container can hold keys (array or object of any kind, including Collections). */
function isKeyContainer(value: any): boolean {
  return value !== null && typeof value === 'object';
}

/** Own-property check that works for arrays, records and Collections. */
function hasKey(target: any, segment: string): boolean {
  if (target === null || target === undefined || typeof target !== 'object') {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(target, segment);
}

/** Values iterated by a '*' wildcard segment. */
function childValues(target: any): any[] {
  if (Array.isArray(target) || isPlainRecord(target) || target instanceof Collection) {
    return Object.values(target);
  }

  return [];
}

/**
 * Walk a dot-notation path, expanding '*' wildcards. Returns every value
 * found; an empty array means the path (or part of it) is missing.
 */
export function resolveSegments(target: any, segments: string[]): any[] {
  if (segments.length === 0) {
    return [target];
  }

  const [head, ...rest] = segments;

  if (head === '*') {
    const results: any[] = [];

    for (const value of childValues(target)) {
      results.push(...resolveSegments(value, rest));
    }

    return results;
  }

  if (hasKey(target, head)) {
    return resolveSegments(target[head], rest);
  }

  return [];
}

/**
 * Loose (PHP ==) comparison for scalar values, used by the non-strict
 * where helpers.
 */
function looselyEqual(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }

  if (a === null || a === undefined) {
    return b === null || b === undefined;
  }

  if (b === null || b === undefined) {
    return false;
  }

  if (typeof a === 'object' || typeof b === 'object') {
    return false;
  }

  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return Boolean(a) === Boolean(b);
  }

  if (typeof a === 'number' || typeof b === 'number') {
    return Number(a) === Number(b);
  }

  return String(a) === String(b);
}

/** Default comparator mirroring PHP's standard array sort order. */
function defaultCompare(a: any, b: any): number {
  if (a < b) {
    return -1;
  }

  return a > b ? 1 : 0;
}

/**
 * Rebuild a filtered entry list back into the original container shape:
 * numeric keys are restored as array indexes (leaving gaps, like PHP),
 * string keys become object properties.
 */
function rebuild(target: any, entries: Array<[CollectionKey, any]>): any {
  if (Array.isArray(target)) {
    const result: any[] = [];

    for (const [key, value] of entries) {
      result[key as number] = value;
    }

    return result;
  }

  const result: Record<string, any> = {};

  for (const [key, value] of entries) {
    result[String(key)] = value;
  }

  return result;
}

export class Arr {
  /**
   * Determine if the given key/value pair is array / object accessible.
   *
   * Arr.accessible([1, 2]) // true
   * Arr.accessible({ a: 1 }) // true
   * Arr.accessible('string') // false
   */
  static accessible(value: any): boolean {
    return Array.isArray(value) || (typeof value === 'object' && value !== null);
  }

  /**
   * Add a value to an array or object if the key does not already exist.
   *
   * Arr.add({ name: 'Taylor' }, 'name', 'Hello') // unchanged
   */
  static add<T extends object>(target: T, key: CollectionKey, value: any): T {
    if (!hasKey(target, String(key))) {
      (target as any)[key] = value;
    }

    return target;
  }

  /**
   * Collapse an array of arrays / collections into a single array.
   *
   * Arr.collapse([[1, 2], [3, 4]]) // [1, 2, 3, 4]
   */
  static collapse(target: readonly any[]): any[] {
    const results: any[] = [];

    for (const item of target) {
      if (Array.isArray(item)) {
        results.push(...item);
      } else if (item instanceof Collection) {
        results.push(...item.all());
      } else if (isPlainRecord(item)) {
        results.push(...Object.values(item));
      } else {
        results.push(item);
      }
    }

    return results;
  }

  /**
   * Separate an array or record's keys and values into two arrays.
   *
   * Arr.divide(['a', 'b']) // [[0, 1], ['a', 'b']]
   */
  static divide(target: any): [CollectionKey[], any[]] {
    const entries = ownEntries(target);

    return [entries.map(([key]) => key), entries.map(([, value]) => value)];
  }

  /**
   * Flatten an associative array of arrays into a single associative array
   * using dot notation keys.
   *
   * Arr.dot({ a: { b: 'c' } }) // { 'a.b': 'c' }
   */
  static dot(target: any, prepend = ''): Record<string, any> {
    const results: Record<string, any> = {};

    // Arrayable (non-array) objects are converted; Collections extend
    // Array and keep their own keys, so they are traversed directly.
    const current =
      target !== null && typeof target === 'object' && !Array.isArray(target) && typeof target.toArray === 'function'
        ? target.toArray()
        : target;

    const traverse = (node: any, prefix: string): void => {
      for (const key of ownKeys(node)) {
        const newKey = prefix ? `${prefix}.${key}` : `${key}`;
        const value = node[key];

        if (Array.isArray(value) || isPlainRecord(value)) {
          traverse(value, newKey);
        } else {
          results[newKey] = value;
        }
      }
    };

    traverse(current, prepend);

    return results;
  }

  /**
   * Expand a dot-notation keyed record back into a nested structure.
   *
   * Arr.undot({ 'a.b': 'c' }) // { a: { b: 'c' } }
   */
  static undot(target: Readonly<Record<string, any>>): any {
    const root: Record<string, any> = {};

    for (const key of Object.keys(target)) {
      const segments = key.split('.');
      let container: any = root;

      for (let index = 0; index < segments.length - 1; index++) {
        const segment = segments[index];

        if (!isKeyContainer(container[segment])) {
          container[segment] = {};
        }

        container = container[segment];
      }

      container[segments[segments.length - 1]] = target[key];
    }

    return densify(root);
  }

  /**
   * Get all of a array / record except the given keys (dot notation aware).
   *
   * Arr.except({ b: 2, d: 4 }, ['b']) // { d: 4 }
   */
  static except(target: any, keys: CollectionKey | CollectionKey[]): any {
    const result: any = Array.isArray(target) ? [...target] : { ...target };

    if (result) {
      Arr.forget(result, keys);
    }

    return result;
  }

  /**
   * Get a subset of the items from the given array / record.
   *
   * Arr.only({ a: 1, b: 2 }, ['a']) // { a: 1 }
   */
  static only(target: any, keys: CollectionKey | CollectionKey[]): Record<string, any> {
    const results: Record<string, any> = {};
    const list = Array.isArray(keys) ? keys : [keys];

    for (const key of list) {
      const value = Arr.get(target, key);

      if (value !== undefined) {
        results[String(key)] = value;
      }
    }

    return results;
  }

  /**
   * Return the first element in an array passing a given truth test.
   */
  static first<T = any, TDefault = T>(
    target: ArrayLikeOrRecord<T>,
    callback?: (value: T, key: CollectionKey) => unknown,
    defaultValue?: TDefault
  ): T | TDefault | undefined {
    const entries = ownEntries(target);

    if (!callback) {
      return entries.length > 0 ? entries[0][1] : defaultValue;
    }

    for (const [key, value] of entries) {
      if (callback(value, key)) {
        return value;
      }
    }

    return defaultValue;
  }

  /**
   * Return the last element in an array passing a given truth test.
   */
  static last<T = any, TDefault = T>(
    target: ArrayLikeOrRecord<T>,
    callback?: (value: T, key: CollectionKey) => unknown,
    defaultValue?: TDefault
  ): T | TDefault | undefined {
    const entries = ownEntries(target);

    if (!callback) {
      return entries.length > 0 ? entries[entries.length - 1][1] : defaultValue;
    }

    for (let index = entries.length - 1; index >= 0; index--) {
      const [key, value] = entries[index];

      if (callback(value, key)) {
        return value;
      }
    }

    return defaultValue;
  }

  /**
   * Flatten a multi-dimensional array into a single level.
   *
   * Arr.flatten([1, 2, [3, 4, [5, 6]]]) // [1, 2, 3, 4, 5, 6]
   */
  static flatten(source: any, flattenKeys = false): any[] {
    const items: any[] = [];

    for (const [, value] of ownEntries(source)) {
      if (Array.isArray(value) || value instanceof Collection || isPlainRecord(value)) {
        const nested = value instanceof Collection ? value.toArray() : value;

        if (flattenKeys && !Arr.isList(nested)) {
          items.push(...ownKeys(nested));
        } else {
          items.push(...Arr.flatten(nested, flattenKeys));
        }
      } else {
        items.push(value);
      }
    }

    return items;
  }

  /**
   * Remove one or many array items from a given array using dot notation.
   *
   * Arr.forget({ products: { name: 'Desk', price: 100 } }, ['products.price'])
   * // { products: { name: 'Desk' } }
   */
  static forget(target: any, keys: CollectionKey | CollectionKey[]): any {
    if (!isKeyContainer(target)) {
      return target;
    }

    const list = Array.isArray(keys) ? keys : [keys];

    for (const key of list) {
      const segments = toSegments(key);
      let container: any = target;

      for (let index = 0; index < segments.length - 1; index++) {
        if (!isKeyContainer(container) || !hasKey(container, segments[index])) {
          container = null;
          break;
        }

        container = container[segments[index]];
      }

      if (isKeyContainer(container)) {
        delete container[segments[segments.length - 1]];
      }
    }

    return target;
  }

  /**
   * Get an item from an array / record using "dot" notation, with '*'
   * wildcard support. Multiple keys return the flattened array of hits.
   *
   * Arr.get({ a: { b: [{ c: 1 }] } }, 'a.b.0.c') // 1
   */
  static get<TDefault = any>(target: any, key: CollectionKey | CollectionKey[], defaultValue?: TDefault): any {
    const keys = Array.isArray(key) ? key : [key];
    const results: any[] = [];

    for (const eachKey of keys) {
      results.push(...resolveSegments(target, toSegments(eachKey)));
    }

    if (results.length > 1) {
      return results.filter((value) => value !== null && value !== undefined);
    }

    if (results.length === 1 && results[0] !== null && results[0] !== undefined) {
      return results[0];
    }

    return defaultValue;
  }

  /**
   * Determine if the given key(s) (dot notation, '*' wildcards allowed)
   * exist and hold a non-null value.
   *
   * Arr.has({ a: { b: 1 } }, 'a.b') // true
   */
  static has(target: any, key: CollectionKey | CollectionKey[]): boolean {
    const keys = Array.isArray(key) ? key : [key];

    if (target === null || target === undefined) {
      return false;
    }

    return keys.every((eachKey) =>
      resolveSegments(target, toSegments(eachKey)).some((value) => value !== null && value !== undefined)
    );
  }

  /**
   * Determine if an array is associative (records are always considered
   * associative, like Laravel's behaviour for objects). Collections are
   * inspected through their own keys.
   */
  static isAssoc(target: any): boolean {
    if (Array.isArray(target)) {
      if (Object.keys(target).length === 0) {
        return false;
      }

      return !Arr.isList(target);
    }

    return isKeyContainer(target);
  }

  /**
   * Determine whether the given value is a list: an array with sequential
   * zero-based numeric keys.
   */
  static isList(target: any): boolean {
    if (!Array.isArray(target)) {
      return false;
    }

    return Object.keys(target).every((key, index) => key === String(index));
  }

  /**
   * Key an associative array by a field or using a callback.
   *
   * Arr.keyBy([{ id: 1, name: 'A' }, { id: 2, name: 'B' }], 'id')
   * // { 1: { id: 1, name: 'A' }, 2: { id: 2, name: 'B' } }
   */
  static keyBy(target: any, callback: ((value: any, key: CollectionKey) => any) | CollectionKey): Record<string, any> {
    const results: Record<string, any> = {};

    for (const [key, value] of ownEntries(target)) {
      let resolved: any;

      if (typeof callback === 'function') {
        resolved = callback(value, key);
      } else {
        const segments = resolveSegments(value, toSegments(callback));
        resolved = segments.length === 1 ? segments[0] : segments.length > 1 ? segments : undefined;
      }

      if (resolved === null || resolved === undefined) {
        continue;
      }

      results[String(resolved)] = value;
    }

    return results;
  }

  /**
   * Pluck an array of values from an array / record, supporting dot
   * notation and wildcards. When a key is given the values are keyed by
   * the plucked key.
   *
   * Arr.pluck([{ id: 1, name: 'A' }, { id: 2, name: 'B' }], 'name') // ['A', 'B']
   * Arr.pluck([...], 'name', 'id') // { 1: 'A', 2: 'B' }
   */
  static pluck(target: any, values: CollectionKey, key?: CollectionKey): any {
    const list: any[] = [];
    const map: Record<string, any> = {};

    for (const [, entry] of ownEntries(target)) {
      const itemValue = resolveOne(entry, values);

      if (key === undefined || key === null) {
        if (Array.isArray(itemValue)) {
          list.push(...itemValue);
        } else {
          list.push(itemValue);
        }
      } else {
        const itemKey = resolveOne(entry, key);

        map[String(itemKey)] = itemValue;
      }
    }

    return key === undefined || key === null ? list : map;
  }

  /**
   * Push a value onto the beginning of an array. For records the key is
   * (re)assigned first. When the given key already exists, the target is
   * returned unchanged, like Laravel's Arr::prepend.
   */
  static prepend<T extends object>(target: T, value: any, key?: CollectionKey): T {
    if (key !== undefined && key !== null && hasKey(target, String(key))) {
      return target;
    }

    if (Array.isArray(target)) {
      (target as any).unshift(value);

      return target;
    }

    const record = target as Record<string, any>;
    const newKey = String(key === undefined || key === null ? Object.keys(record).length : key);
    const entries = Object.entries(record);

    for (const [existing] of entries) {
      delete record[existing];
    }

    record[newKey] = value;

    for (const [existing, existingValue] of entries) {
      record[existing] = existingValue;
    }

    return target;
  }

  /**
   * Get and remove a value from an array / record by key.
   */
  static pull(target: any, key: CollectionKey, defaultValue?: any): any {
    const segment = String(key);
    const value = hasKey(target, segment) ? target[segment] : defaultValue;

    if (isKeyContainer(target)) {
      delete target[segment];
    }

    return value;
  }

  /**
   * Get one or a specified number of random values from an array.
   *
   * Arr.random([1, 2, 3]) // one value
   * Arr.random([1, 2, 3], 2) // array of two values (sampled with replacement)
   */
  static random(target: any): any;
  static random(target: any, length: number): any[];
  static random(target: any, length?: number): any {
    const values = ownEntries(target).map(([, value]) => value);

    if (values.length === 0) {
      throw new Error('Array is empty.');
    }

    if (length === undefined || length === null) {
      return values[Math.floor(Math.random() * values.length)];
    }

    if (length < 0) {
      throw new Error('When calling random with a length, the length must not be negative.');
    }

    if (length > values.length) {
      throw new Error('When calling random with a length, the length must not exceed the size of the array.');
    }

    const results: any[] = [];

    for (let index = 0; index < length; index++) {
      results.push(values[Math.floor(Math.random() * values.length)]);
    }

    return results;
  }

  /**
   * Set an array item to a given value using "dot" notation. Missing
   * intermediate containers are created (arrays for numeric segments,
   * objects otherwise).
   *
   * Arr.set({}, 'a.b', 2) // { a: { b: 2 } }
   */
  static set(target: any, key: CollectionKey | CollectionKey[], value: any): any {
    if (!isKeyContainer(target)) {
      return target;
    }

    const keys = Array.isArray(key) ? key : [key];

    for (const eachKey of keys) {
      setPath(target, toSegments(eachKey), value);
    }

    return target;
  }

  /**
   * Shuffle the given array and return the result. Records are shuffled
   * into a re-indexed array of values, like PHP's shuffle().
   */
  static shuffle(target: any): any[] {
    const values = ownEntries(target).map(([, value]) => value);

    for (let index = values.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [values[index], values[swap]] = [values[swap], values[index]];
    }

    return values;
  }

  /**
   * Sort the array / record using the given comparison function's return
   * value, preserving keys (PHP's asort semantics).
   */
  static sort(target: any, callback?: (a: any, b: any) => number): any {
    const entries = ownEntries(target);
    const compare = callback ?? defaultCompare;

    entries.sort(([, a], [, b]) => compare(a, b));

    if (Array.isArray(target)) {
      return entries.map(([, value]) => value);
    }

    const result: Record<string, any> = {};

    for (const [key, value] of entries) {
      result[String(key)] = value;
    }

    return result;
  }

  /**
   * Sort a multidimensional array / record recursively: lists are sorted
   * by value, records by key.
   */
  static sortRecursive(target: any): any {
    if (Array.isArray(target)) {
      const values = target.map((value) => (isKeyContainer(value) ? Arr.sortRecursive(value) : value));

      return values.sort(defaultCompare);
    }

    if (isPlainRecord(target)) {
      const keys = Object.keys(target).sort(defaultCompare);
      const result: Record<string, any> = {};

      for (const key of keys) {
        const value = target[key];
        result[key] = isKeyContainer(value) ? Arr.sortRecursive(value) : value;
      }

      return result;
    }

    return target;
  }

  /**
   * Transform an associative array of class => condition pairs into a
   * string of CSS class names.
   *
   * Arr.toCssClasses({ 'active': true, 'disabled': false }) // 'active'
   */
  static toCssClasses(classes: Readonly<Record<string, boolean | number | string | null | undefined>>): string {
    return Object.entries(classes)
      .filter(([, condition]) => Boolean(condition))
      .map(([name]) => name)
      .join(' ');
  }

  /**
   * Filter the array using the given callback, comparing the returned
   * value strictly to the item's value (like Laravel's Arr::where).
   */
  static where<T = any>(target: ArrayLikeOrRecord<T>, callback: (value: T) => any): any {
    return rebuild(
      target,
      ownEntries(target).filter(([, value]) => value === callback(value))
    );
  }

  /**
   * Filter items where the given values list contains the item's value.
   * Loose (PHP in_array) comparison by default, like Laravel. Keys are
   * preserved.
   */
  static whereIn<T = any>(target: ArrayLikeOrRecord<T>, values: readonly any[], strict = false): any {
    const list = values instanceof Collection ? values.all() : Array.isArray(values) ? values : Object.values(values);

    return rebuild(
      target,
      ownEntries(target).filter(([, value]) =>
        list.some((candidate: any) => (strict ? candidate === value : looselyEqual(value, candidate)))
      )
    );
  }

  /**
   * Return the given value as an array, if it is not already one.
   *
   * Arr.wrap(null) // []
   * Arr.wrap('string') // ['string']
   */
  static wrap(value: any): any[] {
    if (value === null || value === undefined) {
      return [];
    }

    if (Array.isArray(value)) {
      return value;
    }

    if (value instanceof Collection) {
      return value.toArray();
    }

    if (typeof value === 'object' && typeof value.toArray === 'function') {
      return value.toArray();
    }

    if (isPlainRecord(value)) {
      return value as any;
    }

    return [value];
  }
}

/**
 * Resolve a value against a dot-notation path (wildcards allowed) and
 * collapse the result to a single value, or an array of matches when a
 * wildcard produced more than one.
 */
function resolveOne(item: any, path: CollectionKey): any {
  if (item === null || item === undefined) {
    return null;
  }

  const segments = resolveSegments(item, toSegments(path));

  if (segments.length === 0) {
    return null;
  }

  if (segments.length === 1) {
    return segments[0];
  }

  return segments;
}

/**
 * Create / traverse the container for `segments` on `target`, then assign
 * the final value. Missing intermediates become arrays for numeric
 * segments and plain objects otherwise.
 */
function setPath(target: any, segments: string[], value: any): void {
  let container: any = target;

  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index];
    const next = container[segment];

    if (next === null || next === undefined || typeof next !== 'object') {
      container[segment] = /^\d+$/.test(segments[index + 1]) ? [] : {};
    }

    container = container[segment];
  }

  container[segments[segments.length - 1]] = value;
}

/**
 * Turn a plain-object tree produced by undot into arrays wherever the
 * keys form a dense zero-based numeric sequence (PHP's numeric array key
 * coercion semantics).
 */
function densify(node: any): any {
  if (node === null || typeof node !== 'object') {
    return node;
  }

  const children: Record<string, any> = {};
  const keys = Object.keys(node);

  for (const key of keys) {
    children[key] = densify(node[key]);
  }

  const dense = keys.length > 0 && keys.every((key, index) => /^\d+$/.test(key) && Number(key) === index);

  if (dense) {
    return keys.map((key) => children[key]);
  }

  const result: Record<string, any> = {};

  for (const key of keys) {
    result[key] = children[key];
  }

  return result;
}
