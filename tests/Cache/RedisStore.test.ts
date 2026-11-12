/**
 * RedisStore contract tests
 *
 * Exercises the shared cache Store contract plus the Redis-specific
 * extras (atomic locks via Lua scripts, JSON payloads under the key
 * prefix, scan-based flush) against an in-memory Redis double, so the
 * optional ioredis dependency and a Redis server are not required.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Repository } from '@/Cache/Repository';
import { RedisStore, REDIS_CACHE_LOCK_SCRIPT, REDIS_CACHE_RELEASE_SCRIPT } from '@/Cache/Stores/RedisStore';
import { FakeRedisClient } from './support/FakeRedisClient';
import { runStoreContract } from './support/storeContract';

let client: FakeRedisClient;

function makeStore(): RedisStore {
  return new RedisStore({}, 'cache_', client);
}

beforeEach(() => {
  client = new FakeRedisClient();
});

runStoreContract('RedisStore', () => makeStore(), { touch: true, lockProvider: true });

/**
 * Whether the optional ioredis peer dependency is installed. The
 * lazy-connection error path only exists when it is not, and installing
 * it would mean opening real connections - something a unit suite must
 * not do. Non-literal specifier mirrors the driver's own lazy import.
 */
const ioredisModuleName = 'ioredis';
const ioredisInstalled = await import(ioredisModuleName).then(
  () => true,
  () => false
);

describe('RedisStore specifics', () => {
  let store: RedisStore;

  beforeEach(() => {
    store = makeStore();
  });

  it('stores JSON payloads under the prefixed key', async () => {
    await store.put('greeting', { hello: 'world' }, 60);

    expect(client.strings.get('cache_greeting')?.value).toBe(JSON.stringify({ hello: 'world' }));
  });

  it('reads back values written raw (e.g. lock owners) without failing', async () => {
    await client.set('cache_raw', 'plain-text-not-json');

    expect(await store.get('raw')).toBe('plain-text-not-json');
  });

  it('increment() on a non-numeric payload forgets the key and reports false', async () => {
    await store.put('text', 'not-a-number', 3600);

    expect(await store.increment('text')).toBe(false);
    expect(await store.get('text')).toBeNull();
  });

  it('touch() reports a missing key and refreshes TTLs of existing ones', async () => {
    expect(await store.touch('missing', 60)).toBe(false);

    await store.put('key', 'value', 2);
    expect(await store.ttl('key')).toBe(2);

    expect(await store.touch('key', 120)).toBe(true);
    expect(await store.ttl('key')).toBe(120);
  });

  it('flush() only deletes keys carrying the store prefix', async () => {
    await store.put('mine', 'yes', 3600);
    await client.set('someone-elses', 'keep me');

    expect(await store.flush()).toBe(true);
    expect(await store.get('mine')).toBeNull();
    expect(await client.get('someone-elses')).toBe('keep me');
  });

  it('acquires and releases locks through the atomic Lua scripts', async () => {
    const first = store.lock('job', 30, 'owner-1');
    const second = store.lock('job', 30, 'owner-2');

    expect(await first.get()).toBe(true);
    expect(await second.get()).toBe(false);

    expect(await second.release()).toBe(false);
    expect(await first.release()).toBe(true);

    expect(client.evalCalls.some((call) => call.script === REDIS_CACHE_LOCK_SCRIPT)).toBe(true);
    expect(client.evalCalls.some((call) => call.script === REDIS_CACHE_RELEASE_SCRIPT)).toBe(true);

    // The lock names all run through the store prefix.
    expect(client.evalCalls[0]!.keys).toEqual(['cache_job']);
  });

  it('repository.lock() uses the store-level atomic lock', async () => {
    const repository = new Repository(store);
    const lock = repository.lock('resource', 10);

    expect(await lock.get()).toBe(true);
    expect(client.evalCalls.length).toBe(1);
    expect(await lock.release()).toBe(true);
  });

  it.skipIf(ioredisInstalled)('reports a helpful error when ioredis is not installed', async () => {
    const lazyStore = new RedisStore({ host: '127.0.0.1', port: 6379 }, 'cache_');

    await expect(lazyStore.get('key')).rejects.toThrow(/ioredis/);
  });
});
