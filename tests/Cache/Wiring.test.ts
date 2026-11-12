/**
 * Cache wiring tests
 *
 * Covers the pieces the container glues together: CacheManager hands its
 * event dispatcher to every repository it creates, the `cache.remember`
 * config reaches remember()'s stampede protection, the redis driver is
 * registered by the CacheServiceProvider, and the Cache facade-style
 * manager proxies expose touch()/setPrefix().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Event } from '@/Events/Event';
import { CacheManager } from '@/Cache/CacheManager';
import { CacheServiceProvider } from '@/Cache/CacheServiceProvider';
import { CacheFlushed } from '@/Cache/Events/CacheFlushed';
import { CacheHit } from '@/Cache/Events/CacheHit';
import { KeyWritten } from '@/Cache/Events/KeyWritten';
import { ArrayStore } from '@/Cache/Stores/ArrayStore';
import { RedisStore } from '@/Cache/Stores/RedisStore';
import { Application } from '@/Foundation/Application';
import { ConfigServiceProvider } from '@/Foundation/Config/ConfigServiceProvider';
import { FakeRedisClient } from './support/FakeRedisClient';

class RecordingDispatcher {
  public events: Event[] = [];

  async dispatch(event: Event | string): Promise<unknown[]> {
    this.events.push(event as Event);

    return [];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('CacheManager wiring', () => {
  let manager: CacheManager;
  let events: RecordingDispatcher;

  beforeEach(() => {
    manager = new CacheManager({
      default: 'array',
      prefix: 'app_',
      stores: {
        array: { driver: 'array', serialize: false },
        guarded: { driver: 'array', serialize: false },
      },
      remember: { lock: true, lock_seconds: 5 },
    });

    manager.registerDriver('array', (config) => new ArrayStore(config, manager.getPrefix()));

    events = new RecordingDispatcher();
    manager.setEventDispatcher(events);
  });

  it('hands the dispatcher and store name to created repositories', async () => {
    const repo = manager.store('array');

    await repo.put('key', 'value', 60);
    expect(events.events[0]).toBeInstanceOf(KeyWritten);
    expect((events.events[0] as any).storeName).toBe('array');

    await repo.get('key');
    expect((events.events[1] as any).storeName).toBe('array');
    expect(events.events[1] as any).toBeInstanceOf(CacheHit);

    await repo.flush();
    expect(events.events[2]).toBeInstanceOf(CacheFlushed);
  });

  it('updates live repositories when the dispatcher is set later', async () => {
    const plain = new CacheManager({ default: 'array', prefix: '', stores: { array: { driver: 'array' } } });
    plain.registerDriver('array', () => new ArrayStore());

    const repo = plain.store();
    plain.setEventDispatcher(events);

    await repo.put('key', 'value', 60);
    expect(events.events[0]).toBeInstanceOf(KeyWritten);
  });

  it('passes the top-level remember config to repositories for stampede protection', async () => {
    const repo = manager.store('guarded');

    let calls = 0;
    const callback = async () => {
      calls++;
      await delay(40);

      return 'value';
    };

    const [first, second] = await Promise.all([
      repo.remember('key', 3600, callback),
      repo.remember('key', 3600, callback),
    ]);

    expect(calls).toBe(1);
    expect(first).toBe('value');
    expect(second).toBe('value');

    // The lock lived in the same store and is gone again.
    expect(await repo.getStore().get('orchestr_cache_remember:key')).toBeNull();
  });

  it('lets a store config override the remember defaults', async () => {
    const mgr = new CacheManager({
      default: 'unguarded',
      prefix: '',
      stores: { unguarded: { driver: 'array', remember: { lock: false } } },
      remember: { lock: true, lock_seconds: 5 },
    });

    mgr.registerDriver('array', () => new ArrayStore({ serialize: false }));

    const repo = mgr.store();

    let calls = 0;
    const callback = async () => {
      calls++;
      await delay(20);

      return 'value';
    };

    await Promise.all([repo.remember('key', 3600, callback), repo.remember('key', 3600, callback)]);

    // Lock disabled for this store: no stampede protection, both compute.
    expect(calls).toBe(2);
  });

  it('exposes touch() and setPrefix() on the manager', async () => {
    await manager.put('key', 'value', 2);

    expect(await manager.touch('key', 3600)).toBe(true);
    expect(await manager.get('key')).toBe('value');

    manager.setPrefix('new_');
    expect(manager.getPrefix()).toBe('new_');
    expect(manager.store().getPrefix()).toBe('new_');
  });

  it('creates Redis-backed repositories through the manager', async () => {
    const client = new FakeRedisClient();

    const mgr = new CacheManager({
      default: 'redis',
      prefix: 'redis_',
      stores: { redis: { driver: 'redis' } },
    });

    mgr.registerDriver('redis', (config) => new RedisStore({ ...config, client }, 'redis_'));
    mgr.setEventDispatcher(events);

    const repo = mgr.store();
    await repo.put('key', { ok: true }, 60);

    expect(await repo.get('key')).toEqual({ ok: true });
    expect(client.strings.has('redis_key')).toBe(true);
    expect(events.events[0]).toBeInstanceOf(KeyWritten);

    // lock() goes through the atomic store scripts
    const lock = repo.lock('resource', 10);
    expect(await lock.get()).toBe(true);
    expect(client.evalCalls.length).toBe(1);
  });
});

describe('CacheServiceProvider', () => {
  let app: Application;

  beforeEach(() => {
    app = new Application('/tmp/orchestr-cache-wiring');

    app.instance('config', {
      items: {
        cache: {
          default: 'array',
          prefix: 'app_',
          stores: {
            array: { driver: 'array', serialize: false },
            redis: { driver: 'redis' },
          },
          remember: { lock: true, lock_seconds: 5 },
        },
      },
    });

    app.instance('events', new RecordingDispatcher());

    app.register(new CacheServiceProvider(app));
  });

  it('registers all built-in drivers including redis', () => {
    const manager = app.make<CacheManager>('cache');

    expect(manager.getStoreNames()).toEqual(['array', 'redis']);

    const repo = manager.store('redis');
    expect(repo.getStore()).toBeInstanceOf(RedisStore);
  });

  it('wires the event dispatcher into repositories', async () => {
    const manager = app.make<CacheManager>('cache');
    const events = app.make<RecordingDispatcher>('events');

    await manager.store().put('key', 'value', 60);

    expect(events.events[0]).toBeInstanceOf(KeyWritten);
    expect((events.events[0] as any).storeName).toBe('array');
  });

  it('passes the remember config through', async () => {
    const manager = app.make<CacheManager>('cache');

    let calls = 0;
    const callback = async () => {
      calls++;
      await delay(30);

      return 'value';
    };

    await Promise.all([manager.remember('key', 3600, callback), manager.remember('key', 3600, callback)]);

    expect(calls).toBe(1);
  });

  it('works without an events service registered', () => {
    const bare = new Application('/tmp/orchestr-cache-wiring-bare');
    bare.register(new CacheServiceProvider(bare));

    const manager = bare.make<CacheManager>('cache');

    expect(manager.store()).toBeDefined();
  });
});
