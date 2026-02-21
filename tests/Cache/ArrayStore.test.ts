import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ArrayStore } from '@/Cache/Stores/ArrayStore';

describe('ArrayStore', () => {
  let store: ArrayStore;

  beforeEach(() => {
    store = new ArrayStore({}, 'test_');
  });

  describe('get()', () => {
    it('returns null for missing keys', async () => {
      expect(await store.get('nonexistent')).toBeNull();
    });

    it('returns stored value', async () => {
      await store.put('key', 'value', 3600);
      expect(await store.get('key')).toBe('value');
    });

    it('returns null for expired entries', async () => {
      // Put with very short TTL
      await store.put('key', 'value', 1);
      // Manually expire by advancing time
      vi.useFakeTimers();
      vi.advanceTimersByTime(2000);
      expect(await store.get('key')).toBeNull();
      vi.useRealTimers();
    });

    it('uses prefix for key storage', async () => {
      await store.put('key', 'value', 3600);
      // Key stored with prefix test_key
      expect(await store.get('key')).toBe('value');
    });
  });

  describe('put()', () => {
    it('stores a value with TTL', async () => {
      const result = await store.put('key', 'value', 3600);
      expect(result).toBe(true);
      expect(await store.get('key')).toBe('value');
    });

    it('stores values forever when TTL is 0', async () => {
      await store.put('key', 'forever', 0);
      expect(await store.get('key')).toBe('forever');
    });

    it('stores complex objects', async () => {
      await store.put('obj', { name: 'test', count: 42 }, 3600);
      const result = await store.get('obj');
      expect(result).toEqual({ name: 'test', count: 42 });
    });

    it('overwrites existing values', async () => {
      await store.put('key', 'first', 3600);
      await store.put('key', 'second', 3600);
      expect(await store.get('key')).toBe('second');
    });
  });

  describe('many()', () => {
    it('gets multiple keys at once', async () => {
      await store.put('a', 1, 3600);
      await store.put('b', 2, 3600);
      const result = await store.many(['a', 'b', 'c']);
      expect(result.a).toBe(1);
      expect(result.b).toBe(2);
      expect(result.c).toBeNull();
    });
  });

  describe('putMany()', () => {
    it('stores multiple values', async () => {
      await store.putMany({ a: 1, b: 2 }, 3600);
      expect(await store.get('a')).toBe(1);
      expect(await store.get('b')).toBe(2);
    });
  });

  describe('increment() / decrement()', () => {
    it('increments a value', async () => {
      await store.put('counter', 5, 3600);
      const result = await store.increment('counter', 3);
      expect(result).toBe(8);
      expect(await store.get('counter')).toBe(8);
    });

    it('starts from 0 for missing keys', async () => {
      const result = await store.increment('missing', 1);
      expect(result).toBe(1);
    });

    it('decrements a value', async () => {
      await store.put('counter', 10, 3600);
      const result = await store.decrement('counter', 3);
      expect(result).toBe(7);
    });

    it('defaults to incrementing by 1', async () => {
      await store.put('counter', 0, 3600);
      await store.increment('counter');
      expect(await store.get('counter')).toBe(1);
    });
  });

  describe('forever()', () => {
    it('stores a value without expiration', async () => {
      await store.forever('key', 'permanent');
      expect(await store.get('key')).toBe('permanent');
    });
  });

  describe('forget()', () => {
    it('removes a key', async () => {
      await store.put('key', 'value', 3600);
      const result = await store.forget('key');
      expect(result).toBe(true);
      expect(await store.get('key')).toBeNull();
    });

    it('returns false for missing key', async () => {
      const result = await store.forget('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('flush()', () => {
    it('clears all entries', async () => {
      await store.put('a', 1, 3600);
      await store.put('b', 2, 3600);
      const result = await store.flush();
      expect(result).toBe(true);
      expect(await store.get('a')).toBeNull();
      expect(await store.get('b')).toBeNull();
    });
  });

  describe('getPrefix()', () => {
    it('returns the configured prefix', () => {
      expect(store.getPrefix()).toBe('test_');
    });

    it('returns empty prefix by default', () => {
      const noPrefix = new ArrayStore();
      expect(noPrefix.getPrefix()).toBe('');
    });
  });

  describe('serialization', () => {
    it('serializes by default', async () => {
      const store = new ArrayStore({});
      await store.put('key', { a: 1 }, 3600);
      expect(await store.get('key')).toEqual({ a: 1 });
    });

    it('can disable serialization', async () => {
      const store = new ArrayStore({ serialize: false });
      await store.put('key', 'value', 3600);
      expect(await store.get('key')).toBe('value');
    });
  });
});
