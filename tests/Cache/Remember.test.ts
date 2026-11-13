/**
 * remember() stampede protection tests
 *
 * With `cache.remember.lock` enabled, remember()/rememberForever()
 * guard the callback with a cache lock, re-check the cache after
 * acquiring it, and always release the lock in `finally` - so two
 * concurrent callers execute the callback exactly once and both
 * receive the same value. Without the config the classic behaviour is
 * kept.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Store } from '@/Cache/Contracts/Store';
import { Repository } from '@/Cache/Repository';
import { ArrayStore } from '@/Cache/Stores/ArrayStore';
import { RedisStore } from '@/Cache/Stores/RedisStore';
import { FakeRedisClient } from './support/FakeRedisClient';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LOCK_KEY = 'orchestr_cache_remember:key';

describe('remember() stampede protection', () => {
  let store: Store & { get(key: string): Promise<any> };

  function lockedRepo(config: Record<string, any> = {}): Repository {
    return new Repository(store, {
      remember: { lock: true, lock_seconds: 5, ...config },
    });
  }

  beforeEach(() => {
    store = new ArrayStore({ serialize: false });
  });

  it('runs the callback once for concurrent remember() calls', async () => {
    const repo = lockedRepo();

    let calls = 0;
    const callback = async () => {
      calls++;
      await delay(60);

      return 'computed-value';
    };

    const [first, second, third] = await Promise.all([
      repo.remember('key', 3600, callback),
      repo.remember('key', 3600, callback),
      repo.remember('key', 3600, callback),
    ]);

    expect(calls).toBe(1);
    expect(first).toBe('computed-value');
    expect(second).toBe('computed-value');
    expect(third).toBe('computed-value');

    // The value landed in the cache...
    expect(await store.get('key')).toBe('computed-value');

    // ...and the lock was released.
    expect(await store.get(LOCK_KEY)).toBeNull();
  });

  it('shares the value between remember() and rememberForever() (one shared implementation)', async () => {
    const repo = lockedRepo();

    let calls = 0;
    const callback = async () => {
      calls++;
      await delay(40);

      return 'shared';
    };

    const [timed, forever] = await Promise.all([
      repo.remember('key', 3600, callback),
      repo.rememberForever('key', callback),
    ]);

    expect(calls).toBe(1);
    expect(timed).toBe('shared');
    expect(forever).toBe('shared');
    expect(await store.get(LOCK_KEY)).toBeNull();
  });

  it('always releases the lock when the callback throws', async () => {
    const repo = lockedRepo();

    await expect(
      repo.remember('key', 3600, async () => {
        await delay(10);

        throw new Error('callback exploded');
      })
    ).rejects.toThrow('callback exploded');

    expect(await store.get(LOCK_KEY)).toBeNull();

    // A later attempt succeeds and cleans up as well.
    expect(await repo.remember('key', 3600, () => 'recovered')).toBe('recovered');
    expect(await store.get(LOCK_KEY)).toBeNull();
  });

  it('skips the callback for callers that arrive after the winner wrote the value', async () => {
    const repo = lockedRepo();

    let calls = 0;
    const callback = async () => {
      calls++;
      await delay(40);

      return 'once';
    };

    const holder = repo.remember('key', 3600, callback);

    // Let the holder acquire the lock and start computing, then join.
    await delay(5);
    const joiner = repo.remember('key', 3600, callback);

    expect(await holder).toBe('once');
    expect(await joiner).toBe('once');
    expect(calls).toBe(1);
  });

  it('waits through the lock and takes over when the holder never wrote', async () => {
    const repo = lockedRepo();

    // A foreign lock blocks acquisition; it is still gone before the
    // wait deadline expires, letting the caller compute the value.
    await store.put(LOCK_KEY, 'someone-else', 1);

    let calls = 0;
    const value = await repo.remember('key', 3600, async () => {
      calls++;

      return 'eventually';
    });

    expect(value).toBe('eventually');
    expect(calls).toBe(1);
  });

  it('stays lock-free by default', async () => {
    const plain = new Repository(store);

    let calls = 0;
    const callback = async () => {
      calls++;
      await delay(30);

      return 'value';
    };

    const [first, second] = await Promise.all([
      plain.remember('key', 3600, callback),
      plain.remember('key', 3600, callback),
    ]);

    expect(first).toBe('value');
    expect(second).toBe('value');

    // Without protection both callers may compute (Laravel default too).
    expect(await store.get(LOCK_KEY)).toBeNull();
  });

  it('protects with the atomic Redis lock end to end', async () => {
    const client = new FakeRedisClient();
    const redis = new RedisStore({}, 'cache_', client);
    const repo = new Repository(redis, { remember: { lock: true, lock_seconds: 5 } });

    let calls = 0;
    const callback = async () => {
      calls++;
      await delay(50);

      return 'redis-value';
    };

    const [first, second] = await Promise.all([
      repo.remember('key', 3600, callback),
      repo.remember('key', 3600, callback),
    ]);

    expect(calls).toBe(1);
    expect(first).toBe('redis-value');
    expect(second).toBe('redis-value');

    // The lock went through the atomic Lua scripts, not get/put...
    expect(client.evalCalls.length).toBeGreaterThanOrEqual(2);

    // ...and it is released again.
    expect(await redis.get(LOCK_KEY)).toBeNull();
  });
});
