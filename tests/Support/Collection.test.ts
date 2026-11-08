import { describe, it, expect } from 'vitest';
import type { CollectionKey } from '@/Support/Collection';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleCollection } from '@/Database/Ensemble/EnsembleCollection';
import { Collection, collect } from '@/Support/Collection';

interface UserRecord {
  id: number;
  name: string;
  age: number;
  role: string;
}

function users(): Collection<UserRecord> {
  return collect<UserRecord>([
    { id: 1, name: 'Anna', age: 30, role: 'admin' },
    { id: 2, name: 'Ben', age: 25, role: 'user' },
    { id: 3, name: 'Cala', age: 35, role: 'user' },
  ]);
}

describe('Collection', () => {
  describe('core methods', () => {
    it('all() returns a plain array', () => {
      expect(collect([1, 2, 3]).all()).toEqual([1, 2, 3]);
    });

    it('count(), isEmpty() and isNotEmpty()', () => {
      expect(collect([1, 2, 3]).count()).toBe(3);
      expect(collect().isEmpty()).toBe(true);
      expect(collect().isNotEmpty()).toBe(false);
      expect(collect([1]).isNotEmpty()).toBe(true);
    });

    it('first() returns the first item, or a matching item', () => {
      expect(collect([1, 2, 3]).first()).toBe(1);
      expect(collect([1, 2, 3]).first((x) => x > 1)).toBe(2);
      expect(collect().first()).toBeUndefined();
      expect(collect().first(undefined, 'fallback')).toBe('fallback');
    });

    it('last() returns the last item, or a matching item', () => {
      expect(collect([1, 2, 3]).last()).toBe(3);
      expect(collect([1, 2, 3]).last((x) => x < 3)).toBe(2);
      expect(collect().last(undefined, 9)).toBe(9);
    });

    it('get() returns items by key with a fallback', () => {
      const col = collect({ a: 1, b: 2 });
      expect(col.get('a')).toBe(1);
      expect(col.get('zzz')).toBeUndefined();
      expect(col.get('zzz', 42)).toBe(42);
      expect(collect([1, 2]).get(1)).toBe(2);
    });

    it('has() checks single and multiple keys', () => {
      const col = collect({ a: 1, b: 2 });
      expect(col.has('a')).toBe(true);
      expect(col.has('c')).toBe(false);
      expect(col.has(['a', 'b'])).toBe(true);
      expect(col.has(['a', 'c'])).toBe(false);
      expect(collect([1, 2]).has(1)).toBe(true);
      expect(collect([1, 2]).has(9)).toBe(false);
    });

    it('put() stores values by key and is chainable', () => {
      const col = collect<string>();
      expect(col.put('a', 'x')).toBe(col);
      col.put('b', 'y');
      expect(col.count()).toBe(2);
      expect(col.get('b')).toBe('y');
      col.put('a', 'overwritten');
      expect(col.get('a')).toBe('overwritten');
    });

    it('push() appends values and is chainable', () => {
      expect(collect([1]).push(2, 3).all()).toEqual([1, 2, 3]);
    });

    it('prepend() moves a value to the front', () => {
      expect(collect([2, 3]).prepend(1).all()).toEqual([1, 2, 3]);

      const keyed = collect<number>({ b: 2 });
      keyed.prepend(1, 'a');
      expect(keyed.keys().all()).toEqual(['a', 'b']);
      expect(keyed.get('a')).toBe(1);
    });

    it('pop() removes and returns the final item', () => {
      const col = collect([1, 2, 3]);
      expect(col.pop()).toBe(3);
      expect(col.all()).toEqual([1, 2]);
      expect(collect().pop()).toBeUndefined();
    });

    it('shift() removes and returns the first item', () => {
      const col = collect([1, 2, 3]);
      expect(col.shift()).toBe(1);
      expect(col.all()).toEqual([2, 3]);
      expect(collect().shift()).toBeUndefined();
    });

    it('pull() gets and removes an item by key', () => {
      const col = collect({ a: 1, b: 2 });
      expect(col.pull('a')).toBe(1);
      expect(col.has('a')).toBe(false);
      expect(col.count()).toBe(1);
      expect(col.pull('missing', 99)).toBe(99);
    });

    it('forget() removes single and multiple keys', () => {
      expect(collect([1, 2, 3]).forget(1).all()).toEqual([1, 3]);

      const col = collect({ a: 1, b: 2, c: 3 });
      col.forget(['a', 'c']);
      expect(col.all()).toEqual([2]);
      expect(col.keys().all()).toEqual(['b']);
    });

    it('keys() and values() return collections', () => {
      expect(collect([9, 8]).keys().all()).toEqual([0, 1]);
      expect(collect([9, 8]).values().all()).toEqual([9, 8]);

      const col = collect({ a: 1, b: 2 });
      expect(col.keys().all()).toEqual(['a', 'b']);
      expect(col.values().all()).toEqual([1, 2]);
    });

    it('toArray(), toJson() and jsonSerialize()', () => {
      const col = collect([{ a: 1 }]);
      expect(col.toArray()).toEqual([{ a: 1 }]);
      expect(col.jsonSerialize()).toEqual([{ a: 1 }]);
      expect(col.toJson()).toEqual('[{"a":1}]');

      // nested collections flatten to arrays
      expect(collect([collect([1, 2])]).toArray()).toEqual([[1, 2]]);

      // JSON.stringify integrates with toJSON
      expect(JSON.stringify(collect([{ a: 1 }]))).toEqual('[{"a":1}]');
    });

    it('implode() joins values, optionally by key', () => {
      expect(collect([1, 2, 3]).implode('-')).toBe('1-2-3');
      expect(collect(['a', 'b']).implode(', ')).toBe('a, b');
      expect(users().implode('name', ', ')).toBe('Anna, Ben, Cala');
      expect(collect([1, 2]).implode((value) => `#${value}`, '-')).toBe('#1-#2');
    });

    it('join() glues values, with an optional final glue', () => {
      expect(collect(['A', 'B', 'C']).join(', ', ' and ')).toBe('A, B and C');
      expect(collect(['A', 'B']).join(', ', ' and ')).toBe('A and B');
      expect(collect(['A']).join(', ', ' and ')).toBe('A');
      expect(collect<string>().join(', ', ' and ')).toBe('');
      expect(collect(['A', 'B', 'C']).join('-')).toBe('A-B-C');
    });
  });

  describe('transforms', () => {
    it('map() returns a new collection and preserves keys', () => {
      expect(
        collect([1, 2, 3])
          .map((x) => x * 2)
          .all()
      ).toEqual([2, 4, 6]);

      const mapped = collect({ a: 1, b: 2 }).map((value, key) => `${String(key)}=${value}`);
      expect(mapped.keys().all()).toEqual(['a', 'b']);
      expect(mapped.all()).toEqual(['a=1', 'b=2']);
    });

    it('mapWithKeys() re-keys items', () => {
      const col = users().mapWithKeys((user): [CollectionKey, number] => [user.name, user.age]);
      expect(col.get('Anna')).toBe(30);
      expect(col.keys().all()).toEqual(['Anna', 'Ben', 'Cala']);
    });

    it('flatMap() maps then collapses one level', () => {
      expect(
        collect([1, 2, 3])
          .flatMap((x) => [x, x * 10])
          .all()
      ).toEqual([1, 10, 2, 20, 3, 30]);
      expect(
        collect([1, 2])
          .flatMap((x) => collect([x, x]))
          .all()
      ).toEqual([1, 1, 2, 2]);
    });

    it('filter() keeps truthy values or callback matches', () => {
      expect(collect([0, 1, false, 2, '', 3]).filter().all()).toEqual([1, 2, 3]);
      expect(
        collect([1, 2, 3, 4])
          .filter((x) => x % 2 === 0)
          .all()
      ).toEqual([2, 4]);

      const keyed = collect({ a: 1, b: 2 }).filter((value) => value > 1);
      expect(keyed.keys().all()).toEqual(['b']);
      expect(keyed.all()).toEqual([2]);
    });

    it('reject() removes callback matches', () => {
      expect(
        collect([1, 2, 3, 4])
          .reject((x) => x % 2 === 0)
          .all()
      ).toEqual([1, 3]);
    });

    it('each() iterates and stops when the callback returns false', () => {
      const seen: number[] = [];
      const col = collect([1, 2, 3]);
      expect(
        col.each((value) => {
          seen.push(value);
          return value !== 2;
        })
      ).toBe(col);
      expect(seen).toEqual([1, 2]);
    });

    it('transform() modifies the collection in place', () => {
      const col = collect([1, 2, 3]);
      expect(col.transform((x) => x * 10)).toBe(col);
      expect(col.all()).toEqual([10, 20, 30]);
    });

    it('reduce() folds values with an optional initial carry', () => {
      expect(collect([1, 2, 3]).reduce((carry, value) => carry + value, 0)).toBe(6);
      expect(collect([1, 2, 3]).reduce((carry, value) => (carry as number) + value)).toBe(6);
      expect(collect<number>().reduce((carry, value) => carry + value, 5)).toBe(5);
    });

    it('reduceWithKeys() provides keys to the callback', () => {
      const keys = collect(['a', 'b']).reduceWithKeys<number[]>((carry, _value, key) => {
        carry.push(key as number);
        return carry;
      }, []);
      expect(keys).toEqual([0, 1]);
    });

    it('pluck() extracts values, optionally keyed', () => {
      expect(users().pluck('name').all()).toEqual(['Anna', 'Ben', 'Cala']);
      expect(
        users()
          .pluck((user) => user.age)
          .all()
      ).toEqual([30, 25, 35]);

      const keyed = users().pluck('name', 'id');
      expect(keyed.get(2)).toBe('Ben');
    });

    it('keyBy() keys the collection by an attribute or callback', () => {
      const byName = users().keyBy('name');
      expect(byName.get('Ben')).toEqual({ id: 2, name: 'Ben', age: 25, role: 'user' });

      const byId = users().keyBy((user) => `user_${user.id}`);
      expect(byId.get('user_3')).toEqual({ id: 3, name: 'Cala', age: 35, role: 'user' });
    });

    it('groupBy() groups into a collection of collections', () => {
      const grouped = users().groupBy('role');
      expect(grouped.keys().all()).toEqual(['admin', 'user']);
      expect(grouped.get('user')!.count()).toBe(2);
      expect(grouped.get('admin')!.first()!.name).toBe('Anna');
      expect(grouped.get('user')!.pluck('name').all()).toEqual(['Ben', 'Cala']);

      const callbackGrouped = collect([1, 2, 3, 4]).groupBy((value) => (value % 2 === 0 ? 'even' : 'odd'));
      expect(callbackGrouped.get('even')!.all()).toEqual([2, 4]);
      expect(callbackGrouped.get('odd')!.all()).toEqual([1, 3]);
    });

    it('sort() sorts values into a new collection', () => {
      const col = collect([3, 1, 2]);
      expect(col.sort().all()).toEqual([1, 2, 3]);
      expect(col.all()).toEqual([3, 1, 2]);
      expect(collect(['c', 'a', 'b']).sort().all()).toEqual(['a', 'b', 'c']);
      expect(
        collect([1, 2, 3])
          .sort((a, b) => b - a)
          .all()
      ).toEqual([3, 2, 1]);
    });

    it('sortBy() and sortByDesc() sort by keys or callbacks', () => {
      expect(users().sortBy('age').pluck('name').all()).toEqual(['Ben', 'Anna', 'Cala']);
      expect(users().sortByDesc('age').pluck('name').all()).toEqual(['Cala', 'Anna', 'Ben']);
      expect(
        users()
          .sortBy((user) => user.name)
          .pluck('name')
          .all()
      ).toEqual(['Anna', 'Ben', 'Cala']);
    });

    it('reverse() returns a new reversed collection', () => {
      const col = collect([1, 2, 3]);
      expect(col.reverse().all()).toEqual([3, 2, 1]);
      expect(col.all()).toEqual([1, 2, 3]);
    });

    it('slice() takes an offset and an optional length', () => {
      expect(collect([1, 2, 3, 4]).slice(1).all()).toEqual([2, 3, 4]);
      expect(collect([1, 2, 3, 4]).slice(1, 2).all()).toEqual([2, 3]);
      expect(collect([1, 2, 3]).slice(-2).all()).toEqual([2, 3]);
      expect(collect([1, 2, 3]).slice(10).all()).toEqual([]);

      const keyed = collect({ a: 1, b: 2, c: 3 }).slice(1);
      expect(keyed.keys().all()).toEqual(['b', 'c']);
    });

    it('take() and skip() limit and offset the collection', () => {
      expect(collect([1, 2, 3]).take(2).all()).toEqual([1, 2]);
      expect(collect([1, 2, 3]).take(-1).all()).toEqual([3]);
      expect(collect([1, 2, 3]).take(0).all()).toEqual([]);
      expect(collect([1, 2, 3]).skip(1).all()).toEqual([2, 3]);
      expect(collect([1, 2, 3]).skip(5).all()).toEqual([]);
    });

    it('chunk() splits into equal-sized collections', () => {
      const chunks = collect([1, 2, 3, 4, 5]).chunk(2);
      expect(chunks.count()).toBe(3);
      expect(chunks.all().map((chunk) => chunk.all())).toEqual([[1, 2], [3, 4], [5]]);

      expect(() => collect([1]).chunk(0)).toThrow('Size must be at least 1');
    });

    it('collapse() merges nested arrays one level', () => {
      expect(
        collect([[1, 2], [3], collect([4])])
          .collapse()
          .all()
      ).toEqual([1, 2, 3, 4]);
    });

    it('flatten() flattens nested arrays and collections', () => {
      expect(
        collect([1, [2, [3]], collect([4, [5]])])
          .flatten()
          .all()
      ).toEqual([1, 2, 3, 4, 5]);
      expect(
        collect([1, [2, [3]]])
          .flatten(1)
          .all()
      ).toEqual([1, 2, [3]]);
    });

    it('unique() keeps first occurrences, optionally by key', () => {
      expect(collect([1, 1, 2, 3, 3]).unique().all()).toEqual([1, 2, 3]);
      expect(users().unique('role').pluck('name').all()).toEqual(['Anna', 'Ben']);
      expect(collect([1, '1']).unique().count()).toBe(1);
      expect(collect([1, '1']).unique(undefined, true).count()).toBe(2);
    });

    it('merge() combines items with array_merge semantics', () => {
      expect(collect([1, 2]).merge([2, 3]).all()).toEqual([1, 2, 2, 3]);
      expect(collect({ a: 1 }).merge({ a: 2, b: 3 }).all()).toEqual([2, 3]);
      expect(
        collect([1])
          .merge(collect([2]))
          .all()
      ).toEqual([1, 2]);
    });

    it('concat() appends values, arrays and collections', () => {
      expect(
        collect([1])
          .concat([2, 3], 4, collect([5]))
          .all()
      ).toEqual([1, 2, 3, 4, 5]);
    });

    it('combine() pairs keys with values', () => {
      const col = collect(['a', 'b']).combine([1, 2]);
      expect(col.get('a')).toBe(1);
      expect(col.keys().all()).toEqual(['a', 'b']);
    });

    it('diff() returns items missing from the given items', () => {
      expect(collect([1, 2, 3]).diff([2]).all()).toEqual([1, 3]);
      expect(collect([1, '2']).diff([2]).all()).toEqual([1]);

      const byId = collect([{ id: 1 }, { id: 2 }]).diff([{ id: 2 }], (item: any) => item.id);
      expect(byId.count()).toBe(1);
      expect(byId.first()!.id).toBe(1);
    });

    it('intersect() keeps shared items', () => {
      expect(collect([1, 2, 3]).intersect([2, 5]).all()).toEqual([2]);
      expect(collect([1, 2]).intersect([2], [1]).all()).toEqual([1, 2]);
    });

    it('search() finds keys by value or callback', () => {
      expect(collect(['a', 'b', 'c']).search('b')).toBe(1);
      expect(collect(['a']).search('zzz')).toBe(false);
      expect(collect([1, 2, 3]).search((value) => value === 2)).toBe(1);

      const keyed = collect({ x: 5 }).search(5);
      expect(keyed).toBe('x');
    });

    it('random() picks items and throws when empty', () => {
      const col = collect([1, 2, 3]);
      expect([1, 2, 3]).toContain(col.random());

      const several = col.random(2);
      expect(several.count()).toBe(2);
      expect(several.unique().count()).toBe(2);

      expect(() => collect().random()).toThrow('Collection is empty');
      expect(() => col.random(10)).toThrow('must not exceed');
    });

    it('shuffle() returns a new collection with the same items', () => {
      const col = collect([1, 2, 3, 4, 5]);
      const shuffled = col.shuffle();
      expect(shuffled.count()).toBe(5);
      expect(shuffled.sort().all()).toEqual(col.all());
    });
  });

  describe('aggregates', () => {
    it('sum() totals values, keys and callbacks', () => {
      expect(collect([1, 2, 3]).sum()).toBe(6);
      expect(users().sum('age')).toBe(90);
      expect(users().sum((user) => user.age * 2)).toBe(180);
      expect(collect(['a', 1]).sum()).toBe(1);
    });

    it('avg() averages values and keys', () => {
      expect(collect([1, 2, 3]).avg()).toBe(2);
      expect(users().avg('age')).toBe(30);
      expect(collect<number>().avg()).toBe(0);
    });

    it('median() returns the middle value', () => {
      expect(collect([3, 1, 2]).median()).toBe(2);
      expect(collect([1, 2, 3, 4]).median()).toBe(2.5);
      expect(collect<number>().median()).toBe(0);
    });

    it('mode() returns the most frequent values', () => {
      expect(collect([1, 1, 2, 2, 3]).mode()).toEqual([1, 2]);
      expect(collect(['a', 'b', 'b']).mode()).toEqual(['b']);
    });

    it('min() and max() return extremes for values or keys', () => {
      expect(collect([5, 3, 1]).min()).toBe(1);
      expect(collect([5, 3, 1]).max()).toBe(5);
      expect(users().min('age')).toBe(25);
      expect(users().max('age')).toBe(35);
      expect(collect<number>().min()).toBeUndefined();
    });

    it('contains() matches values, callbacks and arrays', () => {
      expect(collect(['a', 'b']).contains('a')).toBe(true);
      expect(collect([1]).contains('1')).toBe(true);
      expect(collect(['a']).contains('z')).toBe(false);
      expect(collect([1, 2]).contains((value: number) => value === 2)).toBe(true);
      expect(collect(['a', 'b']).contains(['a', 'b'])).toBe(true);
      expect(collect(['a']).contains(['a', 'z'])).toBe(false);
    });

    it('doesntContain() negates contains', () => {
      expect(collect(['a']).doesntContain('b')).toBe(true);
      expect(collect(['a']).doesntContain('a')).toBe(false);
    });
  });

  describe('query helpers', () => {
    it('where() filters by equality, operators and callbacks', () => {
      expect(users().where('role', 'user').pluck('name').all()).toEqual(['Ben', 'Cala']);
      expect(users().where('age', '>=', 30).pluck('name').all()).toEqual(['Anna', 'Cala']);
      expect(users().where('role', '!=', 'user').pluck('name').all()).toEqual(['Anna']);
      expect(
        users()
          .where((user) => user.age < 30)
          .pluck('name')
          .all()
      ).toEqual(['Ben']);
    });

    it('whereIn() and whereNotIn() filter by lists', () => {
      expect(users().whereIn('name', ['Anna', 'Cala']).pluck('name').all()).toEqual(['Anna', 'Cala']);
      expect(users().whereNotIn('name', ['Anna']).pluck('name').all()).toEqual(['Ben', 'Cala']);

      // loose by default, strict when asked
      expect(users().whereIn('age', ['25']).count()).toBe(1);
      expect(users().whereIn('age', ['25'], true).count()).toBe(0);

      expect(
        users()
          .whereIn('name', collect(['Ben']))
          .pluck('name')
          .all()
      ).toEqual(['Ben']);
    });

    it('firstWhere() returns the first match', () => {
      expect(users().firstWhere('role', 'user')).toEqual({ id: 2, name: 'Ben', age: 25, role: 'user' });
      expect(users().firstWhere('age', '>=', 30)!.name).toBe('Anna');
      expect(users().firstWhere('role', 'ghost')).toBeUndefined();
    });

    it('when() runs callbacks based on a condition or truth test', () => {
      expect(
        collect([1, 2, 3])
          .when(true, (col) => col.take(1))
          .all()
      ).toEqual([1]);
      expect(
        collect([1, 2, 3])
          .when(false, (col) => col.take(1))
          .all()
      ).toEqual([1, 2, 3]);
      expect(collect([1, 2, 3]).when(false, undefined, (col) => col.count())).toBe(3);
      expect(
        collect([1, 2, 3]).when(
          (col) => col.count() > 2,
          (col) => col.sum()
        )
      ).toBe(6);
    });

    it('unless() runs callbacks when the condition fails', () => {
      expect(
        collect([1, 2, 3])
          .unless(false, (col) => col.take(1))
          .all()
      ).toEqual([1]);
      expect(
        collect([1, 2, 3])
          .unless(true, (col) => col.take(1))
          .all()
      ).toEqual([1, 2, 3]);
    });

    it('tap() passes the collection through and returns it', () => {
      const col = collect([1, 2]);
      let seen = 0;
      expect(col.tap((instance) => (seen = instance.count()))).toBe(col);
      expect(seen).toBe(2);
    });

    it('pipe() returns the callback result', () => {
      expect(collect([1, 2, 3]).pipe((col) => col.sum())).toBe(6);
    });
  });

  describe('static methods', () => {
    it('make() creates collections', () => {
      expect(Collection.make([1, 2]).all()).toEqual([1, 2]);
      expect(Collection.make().isEmpty()).toBe(true);
    });

    it('wrap() coerces values into collections', () => {
      expect(Collection.wrap(null).isEmpty()).toBe(true);
      expect(Collection.wrap(5).all()).toEqual([5]);
      expect(Collection.wrap('a').all()).toEqual(['a']);
      expect(Collection.wrap([1, 2]).all()).toEqual([1, 2]);

      const col = collect([1]);
      expect(Collection.wrap(col)).toBe(col);

      expect(Collection.wrap({ a: 1 }).all()).toEqual([1]);
      expect(Collection.wrap(new Date()).all().length).toBe(1);
    });

    it('unwrap() returns arrays from collections', () => {
      expect(Collection.unwrap(collect([1, 2]))).toEqual([1, 2]);
      expect(Collection.unwrap('plain')).toBe('plain');
    });

    it('range() generates inclusive number ranges', () => {
      expect(Collection.range(1, 3).all()).toEqual([1, 2, 3]);
      expect(Collection.range(3, 1).all()).toEqual([3, 2, 1]);
      expect(Collection.range(1, 10, 3).all()).toEqual([1, 4, 7, 10]);
    });

    it('times() invokes a callback for a count', () => {
      expect(Collection.times(3).all()).toEqual([1, 2, 3]);
      expect(Collection.times(0).all()).toEqual([]);
      expect(Collection.times(3, (index) => index * 2).all()).toEqual([2, 4, 6]);
    });
  });

  describe('collect() helper', () => {
    it('creates collections from arrays and records', () => {
      expect(
        collect([1, 2, 3])
          .map((x) => x * 2)
          .all()
      ).toEqual([2, 4, 6]);
      expect(collect({ a: 1 }).count()).toBe(1);
      expect(collect().count()).toBe(0);
    });
  });

  describe('array compatibility', () => {
    it('supports indexing, length and iteration', () => {
      const col = collect([10, 20, 30]);
      expect(col[0]).toBe(10);
      expect(col.length).toBe(3);
      expect(Array.isArray(col)).toBe(true);

      const iterated: number[] = [];
      for (const value of col) {
        iterated.push(value);
      }
      expect(iterated).toEqual([10, 20, 30]);

      expect([...col]).toEqual([10, 20, 30]);
    });

    it('is an instanceof Collection and Array', () => {
      const col = collect([1]);
      expect(col).toBeInstanceOf(Collection);
      expect(col).toBeInstanceOf(Array);
    });
  });
});

// ---------------------------------------------------------------------------
// EnsembleCollection compatibility
// ---------------------------------------------------------------------------

class MockEnsemble extends Ensemble {
  static table = 'mocks';
  static primaryKey = 'id';

  constructor(attrs: Record<string, any> = {}) {
    super();
    this.attributes = attrs;
  }
}

function createCollection(items: Record<string, any>[]): EnsembleCollection<MockEnsemble> {
  return new EnsembleCollection(items.map((attrs) => new MockEnsemble(attrs)));
}

describe('EnsembleCollection compatibility', () => {
  it('extends Collection', () => {
    const col = createCollection([{ id: 1 }]);
    expect(col).toBeInstanceOf(Collection);
    expect(col).toBeInstanceOf(EnsembleCollection);
    expect(col).toBeInstanceOf(Array);
  });

  it('supports the existing constructor, indexing, length and iteration', () => {
    const col = createCollection([{ id: 1 }, { id: 2 }]);
    expect(col.length).toBe(2);
    expect(col[0].getKey()).toBe(1);
    expect(col[1].getKey()).toBe(2);

    const keys: any[] = [];
    for (const model of col) {
      keys.push(model.getKey());
    }
    expect(keys).toEqual([1, 2]);

    expect([...col].map((model) => model.getKey())).toEqual([1, 2]);
    expect(new EnsembleCollection().isEmpty()).toBe(true);
  });

  it('serializes models through toArray / toJSON', () => {
    const col = createCollection([
      { id: 1, title: 'A' },
      { id: 2, title: 'B' },
    ]);

    expect(col.toArray()).toEqual([
      { id: 1, title: 'A' },
      { id: 2, title: 'B' },
    ]);
    expect(col.toJSON()).toEqual(col.toArray());
    expect(JSON.stringify(col)).toEqual('[{"id":1,"title":"A"},{"id":2,"title":"B"}]');
  });

  it('keeps model-specific helpers', () => {
    const col = createCollection([{ id: 1 }, { id: 2 }, { id: 3 }]);

    expect(col.modelKeys()).toEqual([1, 2, 3]);
    expect(col.find(2)!.getKey()).toBe(2);
    expect(col.find((item: MockEnsemble) => item.getKey() === 3)!.getKey()).toBe(3);
    expect(col.contains(2)).toBe(true);
    expect(col.contains(99)).toBe(false);
    expect(col.contains((item: MockEnsemble) => item.getKey() === 1)).toBe(true);
    expect(col.except([1, 2]).modelKeys()).toEqual([3]);
    expect(col.only([2, 3]).modelKeys()).toEqual([2, 3]);
    expect(col.mapIntoCollection((item) => item.getKey())).toEqual([1, 2, 3]);
    expect((col.take(2) as EnsembleCollection<MockEnsemble>).modelKeys()).toEqual([1, 2]);
    expect(col.chunkModels(2)).toHaveLength(2);
  });

  it('load() is chainable on the collection', async () => {
    const col = createCollection([{ id: 1 }]);
    await expect(col.load('posts')).resolves.toBe(col);
  });

  it('generic operations return EnsembleCollection instances', () => {
    const col = createCollection([
      { id: 1, role: 'admin' },
      { id: 2, role: 'user' },
    ]);

    expect(col.filter((item) => item.getKey() === 1)).toBeInstanceOf(EnsembleCollection);
    expect(col.reject((item) => item.getKey() === 1)).toBeInstanceOf(EnsembleCollection);
    expect(col.take(1)).toBeInstanceOf(EnsembleCollection);
    expect(col.skip(1)).toBeInstanceOf(EnsembleCollection);
    expect(col.merge([new MockEnsemble({ id: 3 })])).toBeInstanceOf(EnsembleCollection);
    expect(col.unique('id' as any)).toBeInstanceOf(EnsembleCollection);
    expect(col.whereIn('id' as any, [1])).toBeInstanceOf(EnsembleCollection);
    expect(col.groupBy((item) => String(item.getKey()))).toBeInstanceOf(Collection);
    expect(col.groupBy((item) => String(item.getKey())).all()[0]).toBeInstanceOf(EnsembleCollection);
    expect(col.chunk(1).all()[0]).toBeInstanceOf(EnsembleCollection);
    expect(col.first()!.getKey()).toBe(1);
    expect(col.last()!.getKey()).toBe(2);
    expect(col.count()).toBe(2);
  });

  it('works with model relations and serialization (eager-loading shape)', () => {
    const parent = new MockEnsemble({ id: 1 });
    const children = new EnsembleCollection([new MockEnsemble({ id: 2, parent_id: 1 })]);

    // Relations store EnsembleCollections the same way match() does during eager loads
    parent.setRelation('children', children);
    expect(parent.getRelation('children')).toBeInstanceOf(EnsembleCollection);

    // Model serialization maps over the collection (Ensemble.toObject)
    const object = parent.toObject();
    expect(Array.isArray(object.children)).toBe(true);
    expect(object.children.map((child: any) => child.id)).toEqual([2]);

    // Nested JSON serialization keeps working through toJSON hooks
    expect(JSON.parse(JSON.stringify(parent))).toEqual({
      id: 1,
      children: [{ id: 2, parent_id: 1 }],
    });
  });
});

describe('package entry point', () => {
  it('exports Collection and collect', async () => {
    const pkg = await import('@/index');

    expect(pkg.Collection).toBe(Collection);
    expect(pkg.collect).toBe(collect);
    expect(
      pkg
        .collect([1, 2, 3])
        .map((x: number) => x * 2)
        .all()
    ).toEqual([2, 4, 6]);
    expect(pkg.EnsembleCollection).toBe(EnsembleCollection);
  });
});
