/**
 * Collection Class
 *
 * A general-purpose collection mirroring Illuminate\Support\Collection.
 *
 * Items are stored directly on the instance: list items live in numeric
 * array slots, while arbitrary keys (put, keyBy, groupBy, ...) are kept as
 * own enumerable properties. The class therefore still behaves like an
 * array - `collection[0]`, `collection.length` and `for ... of` all work -
 * while providing the full key/value aware Collection API on top.
 *
 * Transform operations are immutable and return new collections. The
 * documented in-place exception is `transform()`, along with the core
 * mutators (put, push, prepend, pop, shift, pull, forget).
 */

export type CollectionKey = string | number;

type KeyOrCallback<T> = CollectionKey | ((value: T, key: CollectionKey) => any);

export class Collection<T = any> extends Array<T> {
  /**
   * Create a new collection
   *
   * Accepts an array, a record, another collection, or - defensively - a
   * length number the way `new Array(length)` does.
   */
  constructor(items: T[] | Collection<T> | Readonly<Record<string, T>> | number = []) {
    super();
    Object.setPrototypeOf(this, new.target.prototype);

    if (typeof items === 'number') {
      this.length = items;
    } else if (items instanceof Collection) {
      for (const [key, value] of (items as Collection<T>).ownEntries()) {
        this.put(key, value);
      }
    } else if (Array.isArray(items)) {
      for (let index = 0; index < items.length; index++) {
        (this as any)[index] = items[index];
      }
    } else {
      for (const key of Object.keys(items)) {
        this.put(Collection.normalizeKey(key), items[key]);
      }
    }
  }

  /**
   * Native Array operations should produce plain arrays, so inherited
   * methods never route construction back through this class.
   */
  static get [Symbol.species](): ArrayConstructor {
    return Array;
  }

  /**
   * Get all items in the collection as a plain array
   */
  all(): T[] {
    return this.ownEntries().map(([, value]) => value);
  }

  /**
   * Get all keys of the collection as a new Collection
   *
   * Note: this intentionally shadows Array.prototype.keys with the
   * Laravel Collection semantics, hence the loose return type.
   */
  keys(): any {
    return this.newCollection<CollectionKey>(this.ownEntries().map(([key]) => key));
  }

  /**
   * Get all values of the collection as a new, re-indexed Collection
   *
   * Note: this intentionally shadows Array.prototype.values with the
   * Laravel Collection semantics, hence the loose return type.
   */
  values(): any {
    return this.newCollection<T>(this.all());
  }

  /**
   * Determine if the collection is empty
   */
  isEmpty(): boolean {
    return this.ownEntries().length === 0;
  }

  /**
   * Determine if the collection is not empty
   */
  isNotEmpty(): boolean {
    return !this.isEmpty();
  }

  /**
   * Count the number of items in the collection
   */
  count(): number {
    return this.ownEntries().length;
  }

  /**
   * Get the first item, optionally the first item matching a truth test
   */
  first(callback?: (value: T, key: CollectionKey) => unknown, defaultValue?: T): T | undefined {
    const entries = this.ownEntries();

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
   * Get the last item, optionally the last item matching a truth test
   */
  last(callback?: (value: T, key: CollectionKey) => unknown, defaultValue?: T): T | undefined {
    const entries = this.ownEntries();

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
   * Get an item by key, with an optional fallback
   */
  get(key: CollectionKey, defaultValue?: T): T | undefined {
    return this.has(key) ? (this as any)[Collection.normalizeKey(key)] : defaultValue;
  }

  /**
   * Determine if one or many keys exist in the collection
   */
  has(keyOrKeys: CollectionKey | CollectionKey[]): boolean {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];

    return keys.every((key) => {
      const normalized = Collection.normalizeKey(key);

      return normalized !== 'length' && Object.prototype.hasOwnProperty.call(this, String(normalized));
    });
  }

  /**
   * Put an item in the collection by key
   */
  put(key: CollectionKey, value: T): this {
    (this as any)[Collection.normalizeKey(key)] = value;

    return this;
  }

  /**
   * Push one or many values onto the end of the collection
   */
  push(...items: T[]): any {
    super.push(...items);

    return this;
  }

  /**
   * Push an item to the beginning of the collection
   */
  prepend(value: T, key?: CollectionKey): this {
    const entries = this.ownEntries();
    entries.unshift([key === undefined ? 0 : Collection.normalizeKey(key), value]);
    this.replaceWith(entries);

    return this;
  }

  /**
   * Remove and return the final item from the collection
   */
  pop(): T | undefined {
    const entries = this.ownEntries();

    if (entries.length === 0) {
      return undefined;
    }

    const value = entries[entries.length - 1][1];
    entries.pop();
    this.replaceWith(entries);

    return value;
  }

  /**
   * Remove and return the first item from the collection
   */
  shift(): T | undefined {
    const entries = this.ownEntries();

    if (entries.length === 0) {
      return undefined;
    }

    const value = entries[0][1];
    entries.shift();
    this.replaceWith(entries);

    return value;
  }

  /**
   * Get and remove an item from the collection by key
   */
  pull(key: CollectionKey, defaultValue?: T): T | undefined {
    const value = this.get(key, defaultValue);
    this.forget(key);

    return value;
  }

  /**
   * Forget one or many keys from the collection
   */
  forget(keyOrKeys: CollectionKey | CollectionKey[]): this {
    const forgetKeys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    const keys = new Set(forgetKeys.map((key) => Collection.normalizeKey(key)));
    this.replaceWith(this.ownEntries().filter(([key]) => !keys.has(key)));

    return this;
  }

  /**
   * Convert the collection to its array representation, recursively
   * serializing nested collections
   */
  toArray(): any[] {
    return this.all().map((item) => (item instanceof Collection ? item.toArray() : item));
  }

  /**
   * Get the collection as JSON serializable data
   */
  jsonSerialize(): any[] {
    return this.toArray();
  }

  /**
   * Convert the collection into a JSON string
   */
  toJson(spacing?: number | string): string {
    return JSON.stringify(this.jsonSerialize(), null, spacing);
  }

  /**
   * Hook used by JSON.stringify
   */
  toJSON(): any[] {
    return this.jsonSerialize();
  }

  /**
   * Concatenate values in the collection with a given glue
   *
   * For lists of objects the first argument is a key or callback and the
   * second the glue: implode('id', ', '). For lists of scalars the first
   * argument is treated as the glue: implode(', ').
   */
  implode(callbackOrKey?: KeyOrCallback<T>, glue = ''): string {
    const entries = this.ownEntries();
    const scalarItems = entries.every(([, value]) => value === null || typeof value !== 'object');

    if (scalarItems && (typeof callbackOrKey === 'string' || typeof callbackOrKey === 'number')) {
      return entries.map(([, value]) => String(value)).join(String(callbackOrKey));
    }

    const values = entries.map(([key, value]) => {
      if (callbackOrKey === undefined || callbackOrKey === null) {
        return value;
      }

      const extracted = Collection.extract(value, callbackOrKey, key);

      return extracted === undefined ? value : extracted;
    });

    return values.map((value) => String(value)).join(glue);
  }

  /**
   * Concatenate values in the collection with a final glue:
   * join(', ', ' and ') -> 'A, B and C'
   */
  join(glue = '', lastGlue?: string): string {
    const values = this.all().map((value) => String(value));

    if (lastGlue === undefined || lastGlue === null || values.length <= 2) {
      return values.join(lastGlue === undefined || lastGlue === null ? glue : lastGlue);
    }

    const finalValue = values[values.length - 1];
    const initialValues = values.slice(0, -1);

    return `${initialValues.join(glue)}${lastGlue}${finalValue}`;
  }

  /**
   * Pass the collection to the given callback and then return it
   */
  tap(callback: (collection: Collection<T>) => unknown): this {
    callback(this);

    return this;
  }

  /**
   * Pass the collection to the given callback and return the result
   */
  pipe<R>(callback: (collection: Collection<T>) => R): R {
    return callback(this);
  }

  /**
   * Execute a callback if the given condition or truth test passes
   */
  when(
    condition: boolean | ((collection: Collection<T>) => unknown),
    callback?: (collection: Collection<T>) => any,
    defaultCallback?: (collection: Collection<T>) => any
  ): any {
    const result = typeof condition === 'function' ? condition(this) : condition;

    if (result) {
      return callback ? callback(this) : this;
    }

    return defaultCallback ? defaultCallback(this) : this;
  }

  /**
   * Execute a callback unless the given condition or truth test passes
   */
  unless(
    condition: boolean | ((collection: Collection<T>) => unknown),
    callback?: (collection: Collection<T>) => any,
    defaultCallback?: (collection: Collection<T>) => any
  ): any {
    const result = typeof condition === 'function' ? condition(this) : condition;

    if (!result) {
      return callback ? callback(this) : this;
    }

    return defaultCallback ? defaultCallback(this) : this;
  }

  /**
   * Iterate over the collection items; returning false stops iteration
   */
  each(callback: (value: T, key: CollectionKey) => unknown): this {
    for (const [key, value] of this.ownEntries()) {
      if (callback(value, key) === false) {
        break;
      }
    }

    return this;
  }

  /**
   * Map the collection to a new collection of the same type, preserving keys
   *
   * The callback is invoked with (value, key); keys are typed as numeric
   * indices for Array compatibility, but string keys are passed through
   * at runtime for keyed collections.
   */
  map<U>(callbackfn: (value: T, index: number, array: any[]) => U, thisArg?: any): Collection<U> {
    const result = this.newCollection<U>([]);

    for (const [key, value] of this.ownEntries()) {
      result.put(key, callbackfn.call(thisArg, value, key as unknown as number, this));
    }

    return result;
  }

  /**
   * Map the collection using a callback that returns [key, value] pairs
   */
  mapWithKeys(callback: (value: T, key: CollectionKey) => [CollectionKey, any]): Collection<any> {
    const result = this.newCollection<any>([]);

    for (const [key, value] of this.ownEntries()) {
      const pair = callback(value, key);
      result.put(Collection.normalizeKey(pair[0]), pair[1]);
    }

    return result;
  }

  /**
   * Map the collection and then collapse one level of arrays / collections
   */
  flatMap<U>(
    callback: (value: T, index: number, array: any[]) => U | readonly U[] | Collection<U>,
    thisArg?: any
  ): Collection<U> {
    const result = this.newCollection<U>([]);

    for (const [key, value] of this.ownEntries()) {
      const mapped = callback.call(thisArg, value, key as unknown as number, this);

      if (mapped instanceof Collection) {
        for (const item of mapped.all()) {
          result.push(item);
        }
      } else if (Array.isArray(mapped)) {
        for (const item of mapped) {
          result.push(item);
        }
      } else {
        result.push(mapped as U);
      }
    }

    return result;
  }

  /**
   * Filter items by the given callback
   *
   * Without a callback, truthy values are kept. The callback is invoked
   * with (value, key); string keys are preserved, numeric keys are
   * re-indexed.
   */
  filter(predicate?: (value: T, index: number, array: any[]) => unknown, thisArg?: any): Collection<T> {
    const entries = this.ownEntries().filter(([key, value]) => {
      if (!predicate) {
        return Boolean(value);
      }

      return Boolean(predicate.call(thisArg, value, key as unknown as number, this));
    });

    return this.newCollectionFromEntries(entries);
  }

  /**
   * Reject items by the given callback, keeping the original keys
   */
  reject(predicate: (value: T, key: CollectionKey) => unknown): Collection<T> {
    return this.filter((value, key) => !predicate(value, key));
  }

  /**
   * Reduce the collection to a single value
   *
   * The callback is invoked with (carry, value, key).
   */
  reduce<U>(
    callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: any[]) => U,
    initialValue?: U
  ): any {
    const entries = this.ownEntries();

    let carry: U;
    let start = 0;

    if (initialValue === undefined) {
      if (entries.length === 0) {
        return undefined;
      }

      carry = entries[0][1] as unknown as U;
      start = 1;
    } else {
      carry = initialValue;
    }

    for (let index = start; index < entries.length; index++) {
      const [key, value] = entries[index];
      carry = callbackfn(carry, value, key as unknown as number, this);
    }

    return carry;
  }

  /**
   * Reduce the collection with the key available to the callback
   */
  reduceWithKeys<R>(callback: (carry: R, value: T, key: CollectionKey) => R, initialValue?: R): any {
    return this.reduce(callback as (carry: R, value: T, index: number) => R, initialValue);
  }

  /**
   * Transform the collection in place
   *
   * This is the documented in-place exception of the otherwise immutable
   * transform API.
   */
  transform(callback: (value: T, key: CollectionKey) => any): this {
    for (const [key, value] of this.ownEntries()) {
      this.put(key, callback(value, key));
    }

    return this;
  }

  /**
   * Pluck a column of values from the collection, optionally keyed by
   * another column
   */
  pluck(values: KeyOrCallback<T>, key?: KeyOrCallback<T>): Collection<any> {
    const result = this.newCollection<any>([]);

    for (const [entryKey, item] of this.ownEntries()) {
      const value = Collection.extract(item, values, entryKey);

      if (key === undefined) {
        result.push(value);
      } else {
        result.put(Collection.normalizeKey(Collection.extract(item, key, entryKey)), value);
      }
    }

    return result;
  }

  /**
   * Key the collection by the given key or callback result
   */
  keyBy(callbackOrKey: KeyOrCallback<T>): Collection<T> {
    const result = this.newCollection<T>([]);

    for (const [key, value] of this.ownEntries()) {
      result.put(Collection.normalizeKey(Collection.extract(value, callbackOrKey, key)), value);
    }

    return result;
  }

  /**
   * Group the collection items by the given key or callback result
   */
  groupBy(callbackOrKey: KeyOrCallback<T>, preserveKeys = false): Collection<Collection<T>> {
    const groups: Array<{ groupKey: CollectionKey; entries: Array<[CollectionKey, T]> }> = [];
    const index = new Map<string, (typeof groups)[number]>();

    for (const [key, value] of this.ownEntries()) {
      const groupKey = Collection.normalizeKey(Collection.extract(value, callbackOrKey, key));
      const bucketKey = String(groupKey);

      let bucket = index.get(bucketKey);

      if (!bucket) {
        bucket = { groupKey, entries: [] };
        index.set(bucketKey, bucket);
        groups.push(bucket);
      }

      bucket.entries.push([preserveKeys ? key : bucket.entries.length, value]);
    }

    const result = this.newCollection<Collection<T>>([]);

    for (const { groupKey, entries } of groups) {
      result.put(groupKey, this.newCollectionFromEntries(entries));
    }

    return result;
  }

  /**
   * Sort the collection values (Laravel asort semantics for string keys;
   * numeric keys are re-indexed)
   */
  sort(compare?: (a: T, b: T) => number): this {
    const defaultCompare = (a: any, b: any): number => {
      if (a < b) {
        return -1;
      }

      return a > b ? 1 : 0;
    };

    const entries = [...this.ownEntries()].sort(([, a], [, b]) => (compare ? compare(a, b) : defaultCompare(a, b)));

    return this.newCollectionFromEntries(entries) as unknown as this;
  }

  /**
   * Sort the collection by a key or callback result
   */
  sortBy(callbackOrKey: KeyOrCallback<T>, descending = false): Collection<T> {
    const factor = descending ? -1 : 1;

    const entries = [...this.ownEntries()].sort(([keyA, valueA], [keyB, valueB]) => {
      const a = Collection.extract(valueA, callbackOrKey, keyA);
      const b = Collection.extract(valueB, callbackOrKey, keyB);

      if (a < b) {
        return -1 * factor;
      }

      if (a > b) {
        return 1 * factor;
      }

      return 0;
    });

    return this.newCollectionFromEntries(entries);
  }

  /**
   * Sort the collection in descending order by a key or callback result
   */
  sortByDesc(callbackOrKey: KeyOrCallback<T>): Collection<T> {
    return this.sortBy(callbackOrKey, true);
  }

  /**
   * Reverse the order of the items in the collection
   */
  reverse(): this {
    return this.newCollection<T>(this.all().reverse()) as unknown as this;
  }

  /**
   * Slice the collection from an offset, with an optional length
   *
   * Note: unlike native Array.slice, the second argument is a length,
   * mirroring Laravel's Collection::slice().
   */
  slice(offset: number, length?: number): Collection<T> {
    const entries = this.ownEntries();
    const start = offset < 0 ? Math.max(entries.length + offset, 0) : offset;
    const sliced = length === undefined ? entries.slice(start) : entries.slice(start, start + Math.max(length, 0));

    return this.newCollectionFromEntries(sliced);
  }

  /**
   * Take the first (or, when negative, the last) n items
   */
  take(limit: number): Collection<T> {
    return limit >= 0 ? this.slice(0, limit) : this.slice(limit);
  }

  /**
   * Skip the first (or, when negative, the last) n items
   */
  skip(count: number): Collection<T> {
    return this.slice(count);
  }

  /**
   * Chunk the collection into smaller collections
   */
  chunk(size: number, preserveKeys = false): Collection<Collection<T>> {
    if (size < 1) {
      throw new Error('Size must be at least 1.');
    }

    const entries = this.ownEntries();
    const result = this.newCollection<Collection<T>>([]);

    for (let index = 0; index < entries.length; index += size) {
      const group = entries.slice(index, index + size);
      const normalized = preserveKeys ? group : group.map(([, value], offset) => [offset, value] as [CollectionKey, T]);

      result.push(this.newCollectionFromEntries(normalized));
    }

    return result;
  }

  /**
   * Collapse a collection of arrays / collections into a single collection
   */
  collapse(): Collection<any> {
    const result = this.newCollection<any>([]);

    for (const value of this.all()) {
      if (value instanceof Collection) {
        for (const item of value.all()) {
          result.push(item);
        }
      } else if (Array.isArray(value)) {
        for (const item of value) {
          result.push(item);
        }
      } else {
        result.push(value);
      }
    }

    return result;
  }

  /**
   * Flatten a multi-dimensional collection up to the given depth
   */
  flatten(depth = Infinity): Collection<any> {
    const result = this.newCollection<any>([]);

    const walk = (values: any[], currentDepth: number): void => {
      for (const value of values) {
        const nested: any[] | null =
          value instanceof Collection ? value.all() : Array.isArray(value) ? (value as any[]) : null;

        if (nested !== null && currentDepth < depth) {
          walk(nested, currentDepth + 1);
        } else {
          result.push(value);
        }
      }
    };

    walk(this.all(), 0);

    return result;
  }

  /**
   * Get the unique items in the collection, optionally by a key or
   * callback result
   */
  unique(callbackOrKey?: KeyOrCallback<T>, strict = false): Collection<T> {
    const seen = new Set<unknown>();
    const entries: Array<[CollectionKey, T]> = [];

    for (const [key, value] of this.ownEntries()) {
      const extracted = callbackOrKey === undefined ? value : Collection.extract(value, callbackOrKey, key);
      const primitive =
        extracted === null ||
        extracted === undefined ||
        (typeof extracted !== 'object' && typeof extracted !== 'function');

      // Strict mode compares identity; loose mode compares primitive
      // values by their string representation, objects by identity.
      const token = strict || !primitive ? extracted : String(extracted);

      if (!seen.has(token)) {
        seen.add(token);
        entries.push([key, value]);
      }
    }

    return this.newCollectionFromEntries(entries);
  }

  /**
   * Merge the collection with the given items using array_merge semantics
   */
  merge(items: T[] | Collection<T> | Readonly<Record<string, T>>): Collection<T> {
    const incoming: Collection<T> =
      items instanceof Collection ? (items as Collection<T>) : new Collection<T>(items as T[]);
    const result = this.newCollection<T>([]);

    for (const [key, value] of this.ownEntries()) {
      result.put(key, value);
    }

    for (const [key, value] of incoming.ownEntries()) {
      if (typeof key === 'number') {
        result.push(value);
      } else {
        result.put(key, value as T);
      }
    }

    return result;
  }

  /**
   * Concatenate values, arrays and collections onto the end of the collection
   */
  concat(...items: Array<T | ConcatArray<T> | readonly T[] | Collection<T>>): Collection<T> {
    const result = this.newCollection<T>([]);

    for (const [key, value] of this.ownEntries()) {
      result.put(key, value);
    }

    for (const value of items) {
      if (value instanceof Collection) {
        for (const item of value.all()) {
          result.push(item);
        }
      } else if (Array.isArray(value)) {
        for (const item of value) {
          result.push(item);
        }
      } else {
        result.push(value as T);
      }
    }

    return result;
  }

  /**
   * Use this collection's values as keys and pair them with the given values
   */
  combine<V>(values: readonly V[]): Collection<any> {
    const result = this.newCollection<any>([]);
    const keys = this.all();

    for (let index = 0; index < values.length; index++) {
      result.put(Collection.normalizeKey(keys[index] as any), values[index]);
    }

    return result;
  }

  /**
   * Get the items from the collection that are not present in the given items
   */
  diff(items: T[] | Collection<T>, callback?: (value: any) => any): Collection<T> {
    const source = items instanceof Collection ? items.all() : items;
    const transformed = callback ? source.map((item) => callback(item)) : source;

    return this.filter((value) => {
      const candidate = callback ? callback(value) : value;

      return !transformed.some((item: any) => Collection.looselyEqual(candidate, item));
    });
  }

  /**
   * Get the intersection of the collection and the given items
   */
  intersect(...items: Array<T[] | Collection<T>>): Collection<T> {
    const source = items.reduce<any[]>(
      (carry, group) => carry.concat(group instanceof Collection ? group.all() : group),
      []
    );

    return this.filter((value) => source.some((item: any) => Collection.looselyEqual(value, item)));
  }

  /**
   * Search for a given value or truth test, returning its key or false
   */
  search(searchTerm: T | ((value: T, key: CollectionKey) => unknown), strict = false): CollectionKey | false {
    const callback =
      typeof searchTerm === 'function' ? (searchTerm as (value: T, key: CollectionKey) => unknown) : null;

    for (const [key, value] of this.ownEntries()) {
      if (callback) {
        if (callback(value, key)) {
          return key;
        }
      } else if (strict ? value === searchTerm : Collection.looselyEqual(value, searchTerm)) {
        return key;
      }
    }

    return false;
  }

  /**
   * Get one or a given number of random items
   */
  random(): T;
  random(count: number): Collection<T>;
  random(count?: number): T | Collection<T> {
    const entries = this.ownEntries();

    if (entries.length === 0) {
      throw new Error('Collection is empty');
    }

    if (count === undefined) {
      return entries[Math.floor(Math.random() * entries.length)][1];
    }

    if (count > entries.length) {
      throw new Error('When calling random with a count, the count must not exceed the collection size');
    }

    const shuffled = [...entries];

    for (let index = shuffled.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }

    return this.newCollection<T>(shuffled.slice(0, count).map(([, value]) => value));
  }

  /**
   * Shuffle the items in the collection into a new collection
   */
  shuffle(): Collection<T> {
    const values = this.all();

    for (let index = values.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [values[index], values[swap]] = [values[swap], values[index]];
    }

    return this.newCollection<T>(values);
  }

  /**
   * Get the sum of the given values or key
   */
  sum(callbackOrKey?: KeyOrCallback<T>): number {
    let total = 0;

    for (const [key, value] of this.ownEntries()) {
      const numeric = Number(callbackOrKey === undefined ? value : Collection.extract(value, callbackOrKey, key));

      if (!Number.isNaN(numeric)) {
        total += numeric;
      }
    }

    return total;
  }

  /**
   * Get the average value of a given key or of the collection values
   */
  avg(callbackOrKey?: KeyOrCallback<T>): number {
    const count = this.count();

    if (count === 0) {
      return 0;
    }

    return this.sum(callbackOrKey) / count;
  }

  /**
   * Get the median value of the collection or of a given key
   */
  median(callbackOrKey?: KeyOrCallback<T>): number {
    const values: number[] = [];

    for (const [key, value] of this.ownEntries()) {
      const numeric = Number(callbackOrKey === undefined ? value : Collection.extract(value, callbackOrKey, key));

      if (!Number.isNaN(numeric)) {
        values.push(numeric);
      }
    }

    if (values.length === 0) {
      return 0;
    }

    values.sort((a, b) => a - b);

    const middle = Math.floor(values.length / 2);

    if (values.length % 2 === 0) {
      return (values[middle - 1] + values[middle]) / 2;
    }

    return values[middle];
  }

  /**
   * Get the most frequent value(s) in the collection or for a given key
   */
  mode(callbackOrKey?: KeyOrCallback<T>): any[] {
    const counts = new Map<string, { value: any; count: number }>();
    let highest = 0;

    for (const [key, value] of this.ownEntries()) {
      const extracted = callbackOrKey === undefined ? value : Collection.extract(value, callbackOrKey, key);
      const token = typeof extracted === 'object' && extracted !== null ? 'object' : String(extracted);
      const bucket = counts.get(token);

      if (bucket) {
        bucket.count += 1;
        highest = Math.max(highest, bucket.count);
      } else {
        const created = { value: extracted, count: 1 };
        counts.set(token, created);
        highest = Math.max(highest, created.count);
      }
    }

    const modes: any[] = [];

    for (const { value, count } of counts.values()) {
      if (count === highest) {
        modes.push(value);
      }
    }

    return modes;
  }

  /**
   * Get the minimum value of the collection or of a given key
   */
  min(callbackOrKey?: KeyOrCallback<T>): any {
    return this.extremum(callbackOrKey, -1);
  }

  /**
   * Get the maximum value of the collection or of a given key
   */
  max(callbackOrKey?: KeyOrCallback<T>): any {
    return this.extremum(callbackOrKey, 1);
  }

  /**
   * Determine if the collection contains the given value, values, or
   * matching truth test
   */
  contains(searchTerm: any): boolean {
    if (typeof searchTerm === 'function') {
      return this.ownEntries().some(([key, value]) => Boolean(searchTerm(value, key)));
    }

    if (Array.isArray(searchTerm)) {
      return searchTerm.every((term) => this.contains(term));
    }

    return this.ownEntries().some(([, value]) => Collection.looselyEqual(value, searchTerm));
  }

  /**
   * Determine if the collection does not contain the given items
   */
  doesntContain(...searchTerms: any[]): boolean {
    return !searchTerms.every((term) => this.contains(term));
  }

  /**
   * Filter items where the given key (or truth test) matches a comparison.
   * Supports where(key, value), where(key, operator, value) and
   * where(callback).
   */
  where(callbackOrKey: KeyOrCallback<T>, operator?: any, value?: any): Collection<T> {
    if (typeof callbackOrKey === 'function') {
      return this.filter((item, key) => Boolean(callbackOrKey(item, key)));
    }

    const comparison = value !== undefined ? value : operator;
    const resolvedOperator = value !== undefined ? String(operator) : '=';

    return this.filter((item, key) =>
      Collection.compare(resolvedOperator, Collection.extract(item, callbackOrKey, key), comparison)
    );
  }

  /**
   * Filter items where the given key's value is within the given values
   */
  whereIn(key: KeyOrCallback<T>, values: any[] | Collection<any>, strict = false): Collection<T> {
    const list = values instanceof Collection ? values.all() : values;

    return this.filter((item, itemKey) => {
      const extracted = Collection.extract(item, key, itemKey);

      return list.some((candidate: any) =>
        strict ? candidate === extracted : Collection.looselyEqual(extracted, candidate)
      );
    });
  }

  /**
   * Filter items where the given key's value is not within the given values
   */
  whereNotIn(key: KeyOrCallback<T>, values: any[] | Collection<any>, strict = false): Collection<T> {
    const list = values instanceof Collection ? values.all() : values;

    return this.filter((item, itemKey) => {
      const extracted = Collection.extract(item, key, itemKey);

      return !list.some((candidate: any) =>
        strict ? candidate === extracted : Collection.looselyEqual(extracted, candidate)
      );
    });
  }

  /**
   * Get the first item matching the given where clause
   */
  firstWhere(key: KeyOrCallback<T>, operator?: any, value?: any): T | undefined {
    return this.where(key, operator, value).first();
  }

  /**
   * Create a new collection from the given items
   */
  static make<R = any>(items?: R[] | Collection<R> | Readonly<Record<string, R>>): Collection<R> {
    const Ctor = this as unknown as new (items?: any) => Collection<R>;

    return new Ctor(items === undefined ? [] : items);
  }

  /**
   * Wrap the given value in a collection if it is not already one
   */
  static wrap<R = any>(value: any): Collection<R> {
    const Ctor = this as unknown as new (items?: any) => Collection<R>;

    if (value === null || value === undefined) {
      return new Ctor([]);
    }

    if (value instanceof Collection) {
      return value;
    }

    if (Array.isArray(value)) {
      return new Ctor(value);
    }

    if (typeof value === 'object' && typeof value.toArray === 'function') {
      return new Ctor(value.toArray());
    }

    if (typeof value === 'object' && !(value instanceof Date) && !(value instanceof Map) && !(value instanceof Set)) {
      return new Ctor(value);
    }

    return new Ctor([value]);
  }

  /**
   * Unwrap the given value, returning all items when it is a collection
   */
  static unwrap(value: any): any {
    return value instanceof Collection ? value.all() : value;
  }

  /**
   * Create a new collection of numbers within an inclusive range
   */
  static range(start: number, end: number, step = 1): Collection<number> {
    const Ctor = this as unknown as new (items?: any) => Collection<number>;
    const values: number[] = [];
    const increment = Math.max(Math.abs(step), 1);

    if (start <= end) {
      for (let value = start; value <= end; value += increment) {
        values.push(value);
      }
    } else {
      for (let value = start; value >= end; value -= increment) {
        values.push(value);
      }
    }

    return new Ctor(values);
  }

  /**
   * Create a new collection by invoking the callback a given number of times
   */
  static times<R = number>(number: number, callback?: (index: number) => R): Collection<R> {
    const Ctor = this as unknown as new (items?: any) => Collection<R>;
    const length = Math.max(number, 0);

    if (!callback) {
      return new Ctor(Array.from({ length }, (_unused, index) => (index + 1) as unknown as R));
    }

    return new Ctor(Array.from({ length }, (_unused, index) => callback(index + 1)));
  }

  /**
   * Build a new collection instance, preserving the concrete class
   */
  protected newCollection<R>(items: R[] | Collection<R> | Readonly<Record<string, R>> | number = []): Collection<R> {
    const Ctor = this.constructor as unknown as new (items?: any) => Collection<R>;

    return new Ctor(items);
  }

  /**
   * Build a new collection from key/value entries
   *
   * String keys are preserved and keep their relative order; numeric keys
   * are re-indexed sequentially so the entry order survives in the
   * underlying array slots.
   */
  protected newCollectionFromEntries(entries: Array<[CollectionKey, T]>): Collection<T> {
    const result = this.newCollection<T>([]);

    for (const [key, value] of entries) {
      if (typeof key === 'number') {
        result.push(value);
      } else {
        result.put(key, value);
      }
    }

    return result;
  }

  /**
   * The collection's own entries as [key, value] pairs: integer keys first
   * in ascending order, then string keys in insertion order
   */
  protected ownEntries(): Array<[CollectionKey, T]> {
    return Object.keys(this).map((key) => [Collection.normalizeKey(key), (this as any)[key]] as [CollectionKey, T]);
  }

  /**
   * Replace all stored entries, densifying numeric keys and preserving
   * string keys so iteration stays consistent with count()
   */
  private replaceWith(entries: Array<[CollectionKey, T]>): void {
    for (const key of Object.keys(this)) {
      delete (this as any)[key];
    }

    this.length = 0;

    let nextIndex = 0;

    for (const [key, value] of entries) {
      if (typeof key === 'number') {
        (this as any)[nextIndex++] = value;
      } else {
        (this as any)[key] = value;
      }
    }

    this.length = nextIndex;
  }

  /**
   * Extremum helper for min/max: direction -1 for min, 1 for max
   */
  private extremum(callbackOrKey: KeyOrCallback<T> | undefined, direction: -1 | 1): any {
    let best: any;
    let found = false;

    for (const [key, value] of this.ownEntries()) {
      const extracted = callbackOrKey === undefined ? value : Collection.extract(value, callbackOrKey, key);

      if (extracted === null || extracted === undefined) {
        continue;
      }

      if (!found) {
        best = extracted;
        found = true;
        continue;
      }

      if (direction === -1 ? extracted < best : extracted > best) {
        best = extracted;
      }
    }

    return found ? best : undefined;
  }

  /**
   * Resolve a value from an item using a key or a callback
   */
  private static extract(item: any, callbackOrKey: KeyOrCallback<any>, key: CollectionKey): any {
    if (typeof callbackOrKey === 'function') {
      return callbackOrKey(item, key);
    }

    if (callbackOrKey === null || callbackOrKey === undefined || item === null || item === undefined) {
      return item;
    }

    return item[callbackOrKey];
  }

  /**
   * Normalize a key so numeric-string keys become real array indexes
   */
  private static normalizeKey(key: CollectionKey): CollectionKey {
    if (typeof key === 'string' && Collection.isIndexKey(key)) {
      return Number(key);
    }

    return key;
  }

  /**
   * Determine whether a property key refers to an array index
   */
  private static isIndexKey(key: string): boolean {
    return /^(0|[1-9]\d*)$/.test(key);
  }

  /**
   * Loose (Laravel ==) comparison for scalar values
   */
  private static looselyEqual(a: any, b: any): boolean {
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

  /**
   * Compare two values with a Laravel-style where operator
   */
  private static compare(operator: string, left: any, right: any): boolean {
    switch (operator) {
      case '>':
        return left > right;
      case '<':
        return left < right;
      case '>=':
        return left >= right;
      case '<=':
        return left <= right;
      case '!=':
      case '<>':
        return !Collection.looselyEqual(left, right);
      default:
        return Collection.looselyEqual(left, right);
    }
  }
}

/**
 * Create a new collection from the given items
 * Laravel: collect([1, 2, 3])
 */
export function collect<T = any>(items?: T[] | Collection<T> | Readonly<Record<string, T>>): Collection<T> {
  return new Collection<T>(items === undefined ? [] : items);
}
