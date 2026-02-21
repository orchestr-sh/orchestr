import { describe, it, expect, beforeEach } from 'vitest';
import { Repository } from '@/Cache/Repository';
import { ArrayStore } from '@/Cache/Stores/ArrayStore';

describe('Repository', () => {
  let store: ArrayStore;
  let repo: Repository;

  beforeEach(() => {
    store = new ArrayStore({ serialize: false });
    repo = new Repository(store);
  });

  describe('get()', () => {
    it('returns cached value', async () => {
      await repo.put('key', 'value', 3600);
      expect(await repo.get('key')).toBe('value');
    });

    it('returns default for missing keys', async () => {
      expect(await repo.get('missing', 'default')).toBe('default');
    });

    it('returns null when no default', async () => {
      expect(await repo.get('missing')).toBeNull();
    });

    it('calls default function if provided', async () => {
      const result = await repo.get('missing', () => 'computed');
      expect(result).toBe('computed');
    });
  });

  describe('put()', () => {
    it('stores a value', async () => {
      const result = await repo.put('key', 'value', 3600);
      expect(result).toBe(true);
    });

    it('uses Date for TTL', async () => {
      const future = new Date(Date.now() + 60000);
      await repo.put('key', 'value', future);
      expect(await repo.get('key')).toBe('value');
    });

    it('stores forever when no TTL and no default', async () => {
      repo.setDefaultCacheTime(null);
      await repo.put('key', 'value');
      expect(await repo.get('key')).toBe('value');
    });

    it('forgets key when TTL is 0 or negative', async () => {
      await repo.put('key', 'value', 3600);
      await repo.put('key', 'new', 0);
      // TTL <= 0 causes forget
      expect(await repo.get('key')).toBeNull();
    });
  });

  describe('has() / missing()', () => {
    it('has() returns true for existing keys', async () => {
      await repo.put('key', 'value', 3600);
      expect(await repo.has('key')).toBe(true);
    });

    it('has() returns false for missing keys', async () => {
      expect(await repo.has('missing')).toBe(false);
    });

    it('missing() is inverse of has()', async () => {
      await repo.put('key', 'value', 3600);
      expect(await repo.missing('key')).toBe(false);
      expect(await repo.missing('absent')).toBe(true);
    });
  });

  describe('pull()', () => {
    it('gets and removes value', async () => {
      await repo.put('key', 'value', 3600);
      const result = await repo.pull('key');
      expect(result).toBe('value');
      expect(await repo.get('key')).toBeNull();
    });

    it('returns default if missing', async () => {
      expect(await repo.pull('missing', 'fallback')).toBe('fallback');
    });
  });

  describe('add()', () => {
    it('stores only if key does not exist', async () => {
      expect(await repo.add('key', 'first', 3600)).toBe(true);
      expect(await repo.add('key', 'second', 3600)).toBe(false);
      expect(await repo.get('key')).toBe('first');
    });
  });

  describe('remember()', () => {
    it('returns cached value if exists', async () => {
      await repo.put('key', 'cached', 3600);
      const result = await repo.remember('key', 3600, () => 'fresh');
      expect(result).toBe('cached');
    });

    it('calls callback and caches if missing', async () => {
      const result = await repo.remember('key', 3600, () => 'computed');
      expect(result).toBe('computed');
      expect(await repo.get('key')).toBe('computed');
    });

    it('handles async callbacks', async () => {
      const result = await repo.remember('key', 3600, async () => 'async-val');
      expect(result).toBe('async-val');
    });
  });

  describe('rememberForever()', () => {
    it('returns cached value if exists', async () => {
      await repo.forever('key', 'cached');
      const result = await repo.rememberForever('key', () => 'fresh');
      expect(result).toBe('cached');
    });

    it('calls callback and caches forever', async () => {
      const result = await repo.rememberForever('key', () => 'computed');
      expect(result).toBe('computed');
      expect(await repo.get('key')).toBe('computed');
    });
  });

  describe('forever()', () => {
    it('stores a value permanently', async () => {
      await repo.forever('key', 'permanent');
      expect(await repo.get('key')).toBe('permanent');
    });
  });

  describe('forget()', () => {
    it('removes a key', async () => {
      await repo.put('key', 'value', 3600);
      await repo.forget('key');
      expect(await repo.get('key')).toBeNull();
    });
  });

  describe('flush()', () => {
    it('clears all entries', async () => {
      await repo.put('a', 1, 3600);
      await repo.put('b', 2, 3600);
      await repo.flush();
      expect(await repo.get('a')).toBeNull();
      expect(await repo.get('b')).toBeNull();
    });
  });

  describe('many() / putMany()', () => {
    it('gets multiple keys', async () => {
      await repo.put('a', 1, 3600);
      await repo.put('b', 2, 3600);
      const result = await repo.many(['a', 'b', 'c']);
      expect(result.a).toBe(1);
      expect(result.b).toBe(2);
      expect(result.c).toBeNull();
    });

    it('puts multiple values', async () => {
      await repo.putMany({ x: 10, y: 20 }, 3600);
      expect(await repo.get('x')).toBe(10);
      expect(await repo.get('y')).toBe(20);
    });
  });

  describe('increment() / decrement()', () => {
    it('increments a value', async () => {
      await repo.put('counter', 5, 3600);
      const result = await repo.increment('counter', 3);
      expect(result).toBe(8);
    });

    it('decrements a value', async () => {
      await repo.put('counter', 10, 3600);
      const result = await repo.decrement('counter', 2);
      expect(result).toBe(8);
    });
  });

  describe('lock()', () => {
    it('creates a lock', () => {
      const lock = repo.lock('resource', 10);
      expect(lock).toBeDefined();
    });
  });

  describe('restoreLock()', () => {
    it('restores a lock with owner', () => {
      const lock = repo.restoreLock('resource', 'owner-123');
      expect(lock).toBeDefined();
    });
  });

  describe('tags()', () => {
    it('returns a TaggedCache', () => {
      const tagged = repo.tags(['tag1', 'tag2']);
      expect(tagged).toBeDefined();
    });

    it('accepts a string tag', () => {
      const tagged = repo.tags('single-tag');
      expect(tagged).toBeDefined();
    });
  });

  describe('accessors', () => {
    it('getStore() returns the underlying store', () => {
      expect(repo.getStore()).toBe(store);
    });

    it('getDefaultCacheTime() returns null by default', () => {
      expect(repo.getDefaultCacheTime()).toBeNull();
    });

    it('setDefaultCacheTime() sets the default', () => {
      repo.setDefaultCacheTime(3600);
      expect(repo.getDefaultCacheTime()).toBe(3600);
    });

    it('getPrefix() delegates to store', () => {
      expect(repo.getPrefix()).toBe('');
    });
  });
});
