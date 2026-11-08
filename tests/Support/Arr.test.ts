import { describe, it, expect } from 'vitest';
import { Arr } from '@/Support/Arr';
import { Collection, collect } from '@/Support/Collection';

describe('Arr', () => {
  describe('accessible() / add() / prepend()', () => {
    it('accessible() detects index-addressable values', () => {
      expect(Arr.accessible([1, 2])).toBe(true);
      expect(Arr.accessible({ a: 1 })).toBe(true);
      expect(Arr.accessible('string')).toBe(false);
      expect(Arr.accessible(null)).toBe(false);
    });

    it('add() only fills missing keys', () => {
      expect(Arr.add({ name: 'Taylor' } as any, 'age', 25)).toEqual({ name: 'Taylor', age: 25 });
      expect(Arr.add({ name: 'Taylor' } as any, 'name', 'Hello')).toEqual({ name: 'Taylor' });

      const list: any[] = [];
      Arr.add(list, 0, 'first');
      expect(list).toEqual(['first']);
    });

    it('prepend() unshifts lists and hoists record keys', () => {
      expect(Arr.prepend([2, 3] as any[], 1)).toEqual([1, 2, 3]);
      expect(Arr.prepend({ b: 2 } as any, 1, 'a')).toEqual({ a: 1, b: 2 });
      expect(Object.keys(Arr.prepend({ b: 2, c: 3 } as any, 1, 'a'))).toEqual(['a', 'b', 'c']);
      expect(Arr.prepend({ a: 1, b: 2 } as any, 9, 'a')).toEqual({ a: 1, b: 2 });
    });
  });

  describe('collapse() / divide()', () => {
    it('collapse() flattens one level', () => {
      expect(
        Arr.collapse([
          [1, 2],
          [3, 4],
        ])
      ).toEqual([1, 2, 3, 4]);
      expect(Arr.collapse([[1, 2], [3, 4], 'five'])).toEqual([1, 2, 3, 4, 'five']);
      expect(Arr.collapse([[1], collect([2, 3]) as any])).toEqual([1, 2, 3]);
      expect(Arr.collapse([])).toEqual([]);
    });

    it('divide() separates keys and values', () => {
      expect(Arr.divide({ a: 1, b: 2 })).toEqual([
        ['a', 'b'],
        [1, 2],
      ]);
      expect(Arr.divide(['a', 'b'])).toEqual([
        [0, 1],
        ['a', 'b'],
      ]);
      expect(Arr.divide({})).toEqual([[], []]);
    });
  });

  describe('dot() / undot()', () => {
    it('dot() flattens nested structures to dot keys', () => {
      expect(Arr.dot({ a: { b: { c: 1 } }, d: 2 })).toEqual({ 'a.b.c': 1, d: 2 });
      expect(Arr.dot({ d: [1, 2] })).toEqual({ 'd.0': 1, 'd.1': 2 });
      expect(Arr.dot({ a: 1 }, 'pre')).toEqual({ 'pre.a': 1 });
      expect(Arr.dot({})).toEqual({});
    });

    it('undot() expands dot keys back into nested values', () => {
      expect(Arr.undot({ 'a.b.c': 1, d: 2 })).toEqual({ a: { b: { c: 1 } }, d: 2 });
      expect(Arr.undot({ 'a.b.0.c': 1, 'a.b.1': 2 })).toEqual({ a: { b: [{ c: 1 }, 2] } });
      expect(Arr.undot({ 'a.0': 1, 'a.2': 3 })).toEqual({ a: { 0: 1, 2: 3 } });
      expect(Arr.undot({})).toEqual({});
    });

    it('dot() and undot() round-trip', () => {
      const source = { a: { b: [{ c: 1 }] }, d: 2 };
      expect(Arr.undot(Arr.dot(source))).toEqual(source);
    });
  });

  describe('except() / only() / forget()', () => {
    it('except() removes keys (dot notation aware)', () => {
      expect(Arr.except({ b: 2, d: 4 }, ['b'])).toEqual({ d: 4 });
      expect(Arr.except({ a: { b: 1, c: 2 } }, ['a.b'])).toEqual({ a: { c: 2 } });
      expect(Arr.except({ a: 1, b: 2 }, 'a')).toEqual({ b: 2 });
    });

    it('only() keeps the listed keys', () => {
      expect(Arr.only({ a: 1, b: 2, c: 3 }, ['a', 'c'])).toEqual({ a: 1, c: 3 });
      expect(Arr.only({ a: { b: 1 } }, ['a.b'])).toEqual({ 'a.b': 1 });
      expect(Arr.only({ a: 1 }, ['missing'])).toEqual({});
    });

    it('forget() deletes dot paths in place', () => {
      expect(Arr.forget({ a: { b: 1, c: 2 } }, ['a.b'])).toEqual({ a: { c: 2 } });
      expect(Arr.forget({ a: 1, b: 2, c: 3 }, ['a', 'c'])).toEqual({ b: 2 });
      expect(Arr.forget({ a: { b: 1 } }, ['x.y.z'])).toEqual({ a: { b: 1 } });
    });
  });

  describe('first() / last() / pull()', () => {
    it('first() and last() respect callbacks and defaults', () => {
      expect(Arr.first([1, 2, 3])).toBe(1);
      expect(Arr.first([1, 2, 3, 4], (value) => value > 2)).toBe(3);
      expect(Arr.first([1, 2], (value) => value > 9, 'fallback')).toBe('fallback');
      expect(Arr.first([])).toBeUndefined();
      expect(Arr.last([1, 2, 3])).toBe(3);
      expect(Arr.last([1, 2, 3], (value) => value < 3)).toBe(2);
      expect(Arr.last([1, 2], (value) => value > 9, 'fallback')).toBe('fallback');
    });

    it('pull() removes and returns the value', () => {
      const target: any = { a: 1, b: 2 };
      expect(Arr.pull(target, 'a')).toBe(1);
      expect(target).toEqual({ b: 2 });
      expect(Arr.pull(target, 'missing', 'default')).toBe('default');
    });
  });

  describe('flatten()', () => {
    it('flatten() merges nested lists', () => {
      expect(Arr.flatten([1, 2, [3, 4, [5, 6]]])).toEqual([1, 2, 3, 4, 5, 6]);
      expect(Arr.flatten([])).toEqual([]);
      expect(Arr.flatten([collect([1, 2]) as any, [3]])).toEqual([1, 2, 3]);
    });

    it('flatten() recurses into records or takes their keys', () => {
      expect(Arr.flatten([{ a: 1, b: 2 }, { c: 3 }])).toEqual([1, 2, 3]);
      expect(Arr.flatten([{ a: 1, b: 2 }, { c: 3 }], true)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('get() / has() / set()', () => {
    it('get() reads dot paths with numeric segments', () => {
      expect(Arr.get({ a: { b: [{ c: 1 }] } }, 'a.b.0.c')).toBe(1);
      expect(Arr.get({ a: 1 }, 'a')).toBe(1);
      expect(Arr.get({ a: 1 }, 'b', 'default')).toBe('default');
      expect(Arr.get({}, 'a.b.c', 'fallback')).toBe('fallback');
      expect(Arr.get({ a: { b: null } }, 'a.b')).toBeUndefined();
      expect(Arr.get(null, 'a', 'default')).toBe('default');
    });

    it('get() supports wildcards and multiple keys', () => {
      expect(Arr.get({ users: [{ age: 20 }, { age: 30 }] }, 'users.*.age')).toEqual([20, 30]);
      expect(Arr.get({ users: [{ age: 20 }] }, 'users.*.age')).toBe(20);
      expect(Arr.get({ a: 1, b: null, c: 3 }, ['a', 'b', 'c', 'z'])).toEqual([1, 3]);
      expect(Arr.get({ users: [{ name: '' }, { name: 'a' }] }, 'users.*.name')).toEqual(['', 'a']);
    });

    it('get() reads through Collections', () => {
      expect(Arr.get(collect({ a: { b: 2 } }), 'a.b')).toBe(2);
    });

    it('has() checks dot paths and wildcards', () => {
      expect(Arr.has({ a: { b: 1 } }, 'a.b')).toBe(true);
      expect(Arr.has({ a: { b: 1 } }, 'a.c')).toBe(false);
      expect(Arr.has({ a: null }, 'a')).toBe(false);
      expect(Arr.has({ users: [{ name: 'a' }] }, 'users.*.name')).toBe(true);
      expect(Arr.has({ a: 1, b: 2 }, ['a', 'b'])).toBe(true);
      expect(Arr.has({ a: 1 }, ['a', 'b'])).toBe(false);
      expect(Arr.has({ a: 1 }, [])).toBe(true);
      expect(Arr.has(null, 'a')).toBe(false);
    });

    it('set() creates missing intermediate containers', () => {
      expect(Arr.set({} as any, 'a.b', 2)).toEqual({ a: { b: 2 } });
      expect(Arr.set({} as any, 'a.0.b', 5)).toEqual({ a: [{ b: 5 }] });
      expect(Arr.set({ a: { b: 1 } } as any, 'a.b', 2)).toEqual({ a: { b: 2 } });
      expect(Arr.set({ items: ['a'] } as any, 'items.1', 'b')).toEqual({ items: ['a', 'b'] });
      expect(Arr.set({} as any, 'plain', 'value')).toEqual({ plain: 'value' });
    });

    it('set() accepts multiple keys', () => {
      expect(Arr.set({} as any, ['a.b', 'a.c'], 'v')).toEqual({ a: { b: 'v', c: 'v' } });
    });
  });

  describe('isAssoc() / isList()', () => {
    it('isAssoc() classifies containers', () => {
      expect(Arr.isAssoc({ a: 1 })).toBe(true);
      expect(Arr.isAssoc([1, 2])).toBe(false);
      expect(Arr.isAssoc([])).toBe(false);
      expect(Arr.isAssoc('string')).toBe(false);
    });

    it('isList() requires a dense zero-based array', () => {
      expect(Arr.isList([1, 2, 3])).toBe(true);
      expect(Arr.isList([])).toBe(true);
      expect(Arr.isList({ 0: 'a', 1: 'b' })).toBe(false);
      expect(Arr.isList('string')).toBe(false);

      const sparse: any[] = [];
      sparse[1] = 'x';
      expect(Arr.isList(sparse)).toBe(false);
    });

    it('isList() works on Collections', () => {
      expect(Arr.isList(collect([1, 2]))).toBe(true);
      expect(Arr.isList(collect({ a: 1 }))).toBe(false);
    });
  });

  describe('keyBy() / pluck()', () => {
    it('keyBy() keys by string, dot path or callback', () => {
      expect(
        Arr.keyBy(
          [
            { id: 1, n: 'a' },
            { id: 2, n: 'b' },
          ],
          'id'
        )
      ).toEqual({
        1: { id: 1, n: 'a' },
        2: { id: 2, n: 'b' },
      });
      expect(Arr.keyBy(['a', 'bb'], (value) => value.length)).toEqual({ 1: 'a', 2: 'bb' });
      expect(Arr.keyBy([{ user: { id: 7 } }], 'user.id')).toEqual({ 7: { user: { id: 7 } } });
      expect(Arr.keyBy([{ id: null }], 'id')).toEqual({});
    });

    it('pluck() extracts values and merges arrays', () => {
      const people = [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ];

      expect(Arr.pluck(people, 'name')).toEqual(['A', 'B']);
      expect(Arr.pluck(people, 'name', 'id')).toEqual({ 1: 'A', 2: 'B' });
      expect(Arr.pluck([{ user: { name: 'A' } }], 'user.name')).toEqual(['A']);
      expect(Arr.pluck([{ id: [1, 2], name: ['a', 'b'] }], '*')).toEqual([
        [1, 2],
        ['a', 'b'],
      ]);
      expect(Arr.pluck([], 'name')).toEqual([]);
    });
  });

  describe('random() / shuffle()', () => {
    it('random() picks values', () => {
      expect([1, 2, 3]).toContain(Arr.random([1, 2, 3]));
      const picked = Arr.random([1, 2, 3, 4], 2);
      expect(picked).toHaveLength(2);
      expect([1, 2, 3, 4]).toEqual(expect.arrayContaining(picked));
    });

    it('random() validates bounds', () => {
      expect(() => Arr.random([])).toThrow('Array is empty.');
      expect(() => Arr.random([1, 2], 3)).toThrow('must not exceed');
      expect(() => Arr.random([1, 2], -1)).toThrow('must not be negative');
    });

    it('shuffle() returns all values', () => {
      const shuffled = Arr.shuffle([1, 2, 3, 4, 5]);
      expect(shuffled).toHaveLength(5);
      expect([...shuffled].sort()).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('sort() / sortRecursive()', () => {
    it('sort() sorts by value preserving keys', () => {
      expect(Arr.sort({ b: 3, c: 2, a: 1 })).toEqual({ a: 1, c: 2, b: 3 });
      expect(Object.keys(Arr.sort({ b: 3, c: 2, a: 1 }))).toEqual(['a', 'c', 'b']);
      expect(Arr.sort([3, 1, 2])).toEqual([1, 2, 3]);
      expect(Arr.sort([1, 3, 2], (a, b) => b - a)).toEqual([3, 2, 1]);
    });

    it('sortRecursive() sorts nested lists by value and records by key', () => {
      expect(
        Arr.sortRecursive([
          [3, 1],
          [2, 4],
        ])
      ).toEqual([
        [1, 3],
        [2, 4],
      ]);
      expect(Arr.sortRecursive({ b: 2, a: 1 })).toEqual({ a: 1, b: 2 });
      expect(Object.keys(Arr.sortRecursive({ b: 1, a: { d: 1, c: 2 } }))).toEqual(['a', 'b']);
    });
  });

  describe('toCssClasses() / where() / whereIn()', () => {
    it('toCssClasses() joins truthy classes', () => {
      expect(Arr.toCssClasses({ active: true, disabled: false })).toBe('active');
      expect(Arr.toCssClasses({ a: 1, b: 0, c: 'yes', d: null })).toBe('a c');
      expect(Arr.toCssClasses({})).toBe('');
    });

    it('where() keeps items equal to the callback result', () => {
      expect(Arr.where({ a: 1, b: 2 }, () => 2)).toEqual({ b: 2 });
      expect(Arr.where([1, 2, 3], () => 2)).toEqual([undefined, 2]);
      expect(Arr.where({ a: 1 }, (value) => value)).toEqual({ a: 1 });
    });

    it('whereIn() filters by membership (loose by default)', () => {
      expect(Arr.whereIn({ a: 1, b: '2', c: 3 }, [1, '2'])).toEqual({ a: 1, b: '2' });
      expect(Arr.whereIn({ a: 1, b: 2 }, [1], true)).toEqual({ a: 1 });
      expect(Arr.whereIn({ a: 1, b: 2 }, collect([2]) as any)).toEqual({ b: 2 });
    });
  });

  describe('wrap()', () => {
    it('wrap() normalises to arrays', () => {
      expect(Arr.wrap(null)).toEqual([]);
      expect(Arr.wrap(undefined)).toEqual([]);
      expect(Arr.wrap('string')).toEqual(['string']);
      expect(Arr.wrap(5)).toEqual([5]);
      expect(Arr.wrap([1, 2])).toEqual([1, 2]);
      expect(Arr.wrap(collect([1, 2]))).toEqual([1, 2]);
      expect(Arr.wrap({ a: 1 })).toEqual({ a: 1 });
    });

    it('wrap() passes arrays through by reference', () => {
      const source = [1, 2];
      expect(Arr.wrap(source)).toBe(source);
    });
  });

  it('dot() flattens Collections and class-like values are leaves', () => {
    expect(Arr.dot(collect({ a: { b: 1 } }))).toEqual({ 'a.b': 1 });

    const date = new Date(0);
    expect(Arr.dot({ when: date })).toEqual({ when: date });
  });

  it('Collection instances are treated as containers where relevant', () => {
    expect(Arr.accessible(new Collection(['a']))).toBe(true);
    expect(Arr.get(new Collection([{ id: 5 }]), '0.id')).toBe(5);
  });
});
