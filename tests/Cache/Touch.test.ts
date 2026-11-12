/**
 * Cache.touch() and Cache.setPrefix() tests
 *
 * touch() extends a key's TTL without changing its value - natively on
 * stores that support it, through a read-modify-write fallback
 * elsewhere - and setPrefix() swaps the key prefix on live stores.
 */

import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Store } from '@/Cache/Contracts/Store';
import { CacheManager } from '@/Cache/CacheManager';
import { Repository } from '@/Cache/Repository';
import { ArrayStore } from '@/Cache/Stores/ArrayStore';
import { FileStore } from '@/Cache/Stores/FileStore';
import { NullStore } from '@/Cache/Stores/NullStore';
import { RedisStore } from '@/Cache/Stores/RedisStore';
import { FakeRedisClient } from './support/FakeRedisClient';

/** A store without native touch support, to exercise the fallback */
class LegacyStore implements Store {
  private values: Map<string, any> = new Map();

  async get<T = any>(key: string): Promise<T | null> {
    return this.values.has(key) ? (this.values.get(key) as T) : null;
  }

  async many<T = any>(keys: string[]): Promise<Record<string, T | null>> {
    const result: Record<string, T | null> = {};
    for (const key of keys) {
      result[key] = (await this.get(key)) ?? null;
    }
    return result;
  }

  async put<T = any>(key: string, value: T): Promise<boolean> {
    this.values.set(key, value);
    return true;
  }

  async putMany<T = any>(values: Record<string, T>): Promise<boolean> {
    for (const [key, value] of Object.entries(values)) {
      await this.put(key, value);
    }
    return true;
  }

  async increment(key: string, value = 1): Promise<number | boolean> {
    const next = ((await this.get<number>(key)) ?? 0) + value;
    await this.put(key, next);
    return next;
  }

  async decrement(key: string, value = 1): Promise<number | boolean> {
    return this.increment(key, -value);
  }

  async forever<T = any>(key: string, value: T): Promise<boolean> {
    return this.put(key, value);
  }

  async forget(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async flush(): Promise<boolean> {
    this.values.clear();
    return true;
  }

  getPrefix(): string {
    return '';
  }
}

describe('Repository.touch()', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('extends the TTL without changing the value', async () => {
    const repo = new Repository(new ArrayStore({ serialize: false }));

    await repo.put('key', 'value', 2);
    expect(await repo.touch('key', 3600)).toBe(true);

    vi.useFakeTimers();
    vi.advanceTimersByTime(60_000);

    expect(await repo.get('key')).toBe('value');
  });

  it('keeps the value forever when no TTL is given', async () => {
    const repo = new Repository(new ArrayStore({ serialize: false }));

    await repo.put('key', 'value', 2);
    expect(await repo.touch('key')).toBe(true);

    vi.useFakeTimers();
    vi.advanceTimersByTime(100 * 24 * 60 * 60 * 1000);

    expect(await repo.get('key')).toBe('value');
  });

  it('reports a missing key as failed', async () => {
    const repo = new Repository(new ArrayStore());

    expect(await repo.touch('missing', 3600)).toBe(false);
  });

  it('accepts a Date deadline', async () => {
    const repo = new Repository(new ArrayStore({ serialize: false }));

    await repo.put('key', 'value', 2);
    expect(await repo.touch('key', new Date(Date.now() + 3600 * 1000))).toBe(true);
  });

  it('falls back to read-modify-write on stores without native touch', async () => {
    const store = new LegacyStore();
    const repo = new Repository(store);

    await repo.put('key', 'value', 3600);
    expect(await repo.touch('key', 60)).toBe(true);
    expect(await store.get('key')).toBe('value');
  });

  it('returns false on the null store', async () => {
    const repo = new Repository(new NullStore());

    expect(await repo.touch('key', 60)).toBe(false);
  });

  it('refreshes the Redis TTL in place', async () => {
    const client = new FakeRedisClient();
    const store = new RedisStore({}, 'cache_', client);
    const repo = new Repository(store);

    await repo.put('key', { a: 1 }, 2);
    expect(await repo.touch('key', 120)).toBe(true);

    expect(await store.ttl('key')).toBe(120);
    expect(await repo.get('key')).toEqual({ a: 1 });
  });
});

describe('setPrefix()', () => {
  let fileDir: string;

  beforeEach(async () => {
    fileDir = await mkdtemp(path.join(tmpdir(), 'orchestr-cache-prefix-'));
  });

  afterEach(async () => {
    await rm(fileDir, { recursive: true, force: true });
  });

  it('updates the store prefix for a repository', async () => {
    const store = new ArrayStore({ serialize: false }, 'old_');
    const repo = new Repository(store);

    await repo.put('key', 'value', 3600);
    expect(await repo.get('key')).toBe('value');

    repo.setPrefix('new_');

    expect(repo.getPrefix()).toBe('new_');
    // Entries written under the old prefix are no longer reachable.
    expect(await repo.get('key')).toBeNull();
    await repo.put('key', 'fresh', 3600);
    expect(await repo.get('key')).toBe('fresh');
  });

  it('updates live stores and future stores through the manager', async () => {
    const manager = new CacheManager({
      default: 'file',
      prefix: 'old_',
      stores: { file: { driver: 'file', path: fileDir } },
    });

    manager.registerDriver('file', (config) => new FileStore(config, manager.getPrefix()));

    const repo = manager.store();
    await repo.put('key', 'value', 3600);

    manager.setPrefix('new_');

    expect(manager.getPrefix()).toBe('new_');
    expect(repo.getPrefix()).toBe('new_');
    expect(await repo.get('key')).toBeNull();

    // Stores created afterwards receive the new prefix as well.
    expect(manager.store().getPrefix()).toBe('new_');
  });
});
