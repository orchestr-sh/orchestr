/**
 * Shared cache Store contract
 *
 * The behaviours every Illuminate-compatible cache store must satisfy,
 * run against each driver implementation (array, file, redis, ...).
 * Optional capabilities (native touch, atomic locks) are exercised when
 * the store under test advertises them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { LockProvider } from '@/Cache/Contracts/LockProvider';
import type { Store } from '@/Cache/Contracts/Store';

export interface StoreContractFeatures {
  /** The store implements touch(key, seconds) natively */
  touch?: boolean;

  /** The store implements the LockProvider contract atomically */
  lockProvider?: boolean;
}

export function runStoreContract(name: string, make: () => Store, features: StoreContractFeatures = {}): void {
  describe(`${name}: store contract`, () => {
    let store: Store;

    beforeEach(() => {
      store = make();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('satisfies the Store contract surface', () => {
      for (const method of ['get', 'many', 'put', 'putMany', 'increment', 'decrement', 'forever', 'forget', 'flush']) {
        expect(typeof (store as any)[method], `${method}()`).toBe('function');
      }

      expect(typeof store.getPrefix()).toBe('string');
    });

    it('get() returns null for missing keys', async () => {
      expect(await store.get('missing')).toBeNull();
    });

    it('put()/get() round-trips values under a TTL', async () => {
      expect(await store.put('key', 'value', 3600)).toBe(true);
      expect(await store.get('key')).toBe('value');
    });

    it('put() overwrites existing values', async () => {
      await store.put('key', 'first', 3600);
      await store.put('key', 'second', 3600);
      expect(await store.get('key')).toBe('second');
    });

    it('round-trips structured values', async () => {
      await store.put('obj', { name: 'test', count: 42, nested: [1, 2, 3] }, 3600);
      expect(await store.get('obj')).toEqual({ name: 'test', count: 42, nested: [1, 2, 3] });
    });

    it('get() returns null once the TTL has elapsed', async () => {
      await store.put('key', 'value', 2);

      vi.useFakeTimers();
      vi.advanceTimersByTime(3000);

      expect(await store.get('key')).toBeNull();
    });

    it('many() returns values and nulls side by side', async () => {
      await store.put('a', 1, 3600);
      await store.put('b', 2, 3600);

      expect(await store.many(['a', 'missing', 'b'])).toEqual({ a: 1, missing: null, b: 2 });
    });

    it('putMany() stores a batch retrievable via many()', async () => {
      expect(await store.putMany({ x: 10, y: 20 }, 3600)).toBe(true);
      expect(await store.many(['x', 'y'])).toEqual({ x: 10, y: 20 });
    });

    it('forever() stores without expiry and survives a put overwrite', async () => {
      expect(await store.forever('key', 'permanent')).toBe(true);
      expect(await store.get('key')).toBe('permanent');

      await store.put('key', 'temporary', 2);
      expect(await store.get('key')).toBe('temporary');

      vi.useFakeTimers();
      vi.advanceTimersByTime(3000);
      expect(await store.get('key')).toBeNull();
    });

    it('forever() entries do not expire', async () => {
      await store.forever('key', 'value');

      vi.useFakeTimers();
      vi.advanceTimersByTime(100 * 24 * 60 * 60 * 1000);

      expect(await store.get('key')).toBe('value');
    });

    it('increment() creates counters and adjusts them', async () => {
      expect(await store.increment('counter', 3)).toBe(3);
      expect(await store.increment('counter')).toBe(4);
      expect(await store.get('counter')).toBe(4);
    });

    it('decrement() lowers counters', async () => {
      await store.put('counter', 10, 3600);
      expect(await store.decrement('counter', 2)).toBe(8);
      expect(await store.increment('counter', 1)).toBe(9);
    });

    it('forget() removes existing keys and reports missing ones', async () => {
      await store.put('key', 'value', 3600);
      expect(await store.forget('key')).toBe(true);
      expect(await store.get('key')).toBeNull();
      expect(await store.forget('key')).toBe(false);
    });

    it('flush() clears every stored key', async () => {
      await store.put('a', 1, 3600);
      await store.forever('b', 2);

      expect(await store.flush()).toBe(true);
      expect(await store.get('a')).toBeNull();
      expect(await store.get('b')).toBeNull();
    });

    it('getPrefix() exposes the configured prefix', () => {
      expect(typeof store.getPrefix()).toBe('string');
    });

    if (features.touch) {
      it('touch() extends the TTL without changing the value', async () => {
        await store.put('key', 'value', 2);

        expect(await store.touch!('key', 3600)).toBe(true);
        expect(await store.get('key')).toBe('value');

        vi.useFakeTimers();
        vi.advanceTimersByTime(120_000);

        expect(await store.get('key')).toBe('value');
      });

      it('touch() with a null TTL makes the entry live forever', async () => {
        await store.put('key', 'value', 2);
        expect(await store.touch!('key', null)).toBe(true);

        vi.useFakeTimers();
        vi.advanceTimersByTime(100 * 24 * 60 * 60 * 1000);

        expect(await store.get('key')).toBe('value');
      });

      it('touch() reports missing keys as failed', async () => {
        expect(await store.touch!('missing', 3600)).toBe(false);
      });
    }

    if (features.lockProvider) {
      const provider = () => store as Store & LockProvider;

      it('lock() is mutually exclusive and owner-checked', async () => {
        const first = provider().lock('resource', 10);
        const second = provider().lock('resource', 10);

        expect(await first.get()).toBe(true);
        expect(await second.get()).toBe(false);

        // A non-owner can never release the lock...
        expect(await second.release()).toBe(false);

        // ...while the owner can, freeing the lock for others.
        expect(await first.release()).toBe(true);
        expect(await second.get()).toBe(true);

        await second.release();
      });

      it('lock() re-acquires for its current owner', async () => {
        const lock = provider().lock('resource', 10);

        expect(await lock.get()).toBe(true);
        expect(await lock.get()).toBe(true);

        await lock.release();
      });

      it('lock() expires after its TTL', async () => {
        const holder = provider().lock('resource', 2);
        expect(await holder.get()).toBe(true);

        const other = provider().lock('resource', 2);
        expect(await other.get()).toBe(false);

        vi.useFakeTimers();
        vi.advanceTimersByTime(3000);

        expect(await other.get()).toBe(true);
        await other.release();
      });

      it('restoreLock() keeps ownership of an existing lock', async () => {
        const holder = provider().lock('resource', 10);
        expect(await holder.get()).toBe(true);

        const restored = provider().restoreLock('resource', holder.owner());
        expect(await restored.get()).toBe(true);
        expect(await restored.release()).toBe(true);

        const other = provider().lock('resource', 10);
        expect(await other.get()).toBe(true);
        await other.release();
      });

      it('forceRelease() drops the lock regardless of ownership', async () => {
        const holder = provider().lock('resource', 10);
        expect(await holder.get()).toBe(true);

        expect(await provider().lock('resource', 10).forceRelease()).toBe(true);

        const other = provider().lock('resource', 10);
        expect(await other.get()).toBe(true);
        await other.release();
      });
    }
  });
}
