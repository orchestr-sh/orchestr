/**
 * Cache event dispatch tests
 *
 * The Repository owns cache events: hits and misses, writes, forgotten
 * keys and flushes must reach the event dispatcher with the store name,
 * key, value, and TTL where Laravel does. TaggedCache dispatches the
 * same events with the tag names attached.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Event } from '@/Events/Event';
import { CacheFlushed } from '@/Cache/Events/CacheFlushed';
import { CacheHit } from '@/Cache/Events/CacheHit';
import { CacheMissed } from '@/Cache/Events/CacheMissed';
import { KeyForgotten } from '@/Cache/Events/KeyForgotten';
import { KeyWritten } from '@/Cache/Events/KeyWritten';
import { Repository } from '@/Cache/Repository';
import { ArrayStore } from '@/Cache/Stores/ArrayStore';
import { RedisStore } from '@/Cache/Stores/RedisStore';
import { FakeRedisClient } from './support/FakeRedisClient';

/**
 * Minimal dispatcher double recording every dispatched event instance
 */
class RecordingDispatcher {
  public events: Event[] = [];

  async dispatch(event: Event | string): Promise<unknown[]> {
    this.events.push(event as Event);

    return [];
  }

  of(eventClass: new (...args: any[]) => Event): any[] {
    return this.events.filter((event) => event instanceof eventClass);
  }

  last(): any {
    return this.events[this.events.length - 1];
  }
}

describe('Cache events', () => {
  let events: RecordingDispatcher;
  let repo: Repository;

  beforeEach(() => {
    events = new RecordingDispatcher();
    repo = new Repository(new ArrayStore({ serialize: false }), {}, events).setStoreName('array');
  });

  it('dispatches CacheMissed on a miss and CacheHit on a hit', async () => {
    expect(await repo.get('key')).toBeNull();

    expect(events.of(CacheMissed)).toHaveLength(1);
    expect(events.of(CacheHit)).toHaveLength(0);
    expect(events.last()).toBeInstanceOf(CacheMissed);
    expect(events.last().storeName).toBe('array');
    expect(events.last().key).toBe('key');

    await repo.put('key', 'value', 3600);

    expect(await repo.get('key')).toBe('value');
    expect(events.of(CacheHit)).toHaveLength(1);

    const hit = events.of(CacheHit)[0] as any;
    expect(hit.storeName).toBe('array');
    expect(hit.key).toBe('key');
    expect(hit.value).toBe('value');
  });

  it('dispatches KeyWritten on put with the TTL in seconds', async () => {
    await repo.put('key', 'value', 120);

    const written = events.of(KeyWritten)[0] as any;
    expect(written.storeName).toBe('array');
    expect(written.key).toBe('key');
    expect(written.value).toBe('value');
    expect(written.seconds).toBe(120);
  });

  it('dispatches KeyWritten with a null TTL on forever', async () => {
    await repo.forever('key', 'permanent');

    const written = events.of(KeyWritten)[0] as any;
    expect(written.key).toBe('key');
    expect(written.value).toBe('permanent');
    expect(written.seconds).toBeNull();
  });

  it('dispatches KeyWritten on increment and decrement with the new value', async () => {
    await repo.put('counter', 5, 3600);
    await repo.increment('counter', 3);
    await repo.decrement('counter', 1);

    const writes = events.of(KeyWritten) as any[];
    expect(writes).toHaveLength(3);
    expect(writes[1].key).toBe('counter');
    expect(writes[1].value).toBe(8);
    expect(writes[2].value).toBe(7);
  });

  it('dispatches KeyForgotten on forget', async () => {
    await repo.forget('key');

    const forgotten = events.of(KeyForgotten)[0] as any;
    expect(forgotten.storeName).toBe('array');
    expect(forgotten.key).toBe('key');
  });

  it('dispatches CacheFlushed on flush', async () => {
    await repo.flush();

    const flushed = events.of(CacheFlushed)[0] as any;
    expect(flushed.storeName).toBe('array');
    expect(flushed.tags).toEqual([]);
  });

  it('routes composed operations through the same events', async () => {
    await repo.put('key', 'value', 3600);
    events.events = [];

    // pull(): hit + forgotten
    expect(await repo.pull('key')).toBe('value');
    expect(events.of(CacheHit)).toHaveLength(1);
    expect(events.of(KeyForgotten)).toHaveLength(1);

    // put with a non-positive TTL forgets instead of writing
    events.events = [];
    await repo.put('expired', 'value', 0);
    expect(events.of(KeyForgotten)).toHaveLength(1);
    expect(events.of(KeyWritten)).toHaveLength(0);
  });

  it('dispatches remember() hits and writes', async () => {
    await repo.remember('key', 3600, () => 'computed');

    expect(events.of(CacheMissed)).toHaveLength(1);
    const written = events.of(KeyWritten)[0] as any;
    expect(written.value).toBe('computed');
    expect(written.seconds).toBe(3600);

    events.events = [];
    await repo.remember('key', 3600, () => 'fresh');

    expect(events.of(CacheHit)).toHaveLength(1);
    expect(events.of(KeyWritten)).toHaveLength(0);
  });

  it('stays silent without a dispatcher', async () => {
    const plain = new Repository(new ArrayStore());

    // Nothing to assert beyond "does not throw"
    await plain.put('key', 'value', 3600);
    expect(await plain.get('key')).toBe('value');
    expect(await plain.flush()).toBe(true);
  });

  it('includes the store name set by the manager', async () => {
    const client = new FakeRedisClient();
    const redisEvents = new RecordingDispatcher();
    const redis = new Repository(new RedisStore({}, 'cache_', client), {}, redisEvents).setStoreName('redis');

    await redis.put('key', 'value', 60);

    expect(redisEvents.last().storeName).toBe('redis');
  });

  describe('tagged cache events', () => {
    it('dispatches the same events with tag names attached', async () => {
      const tagged = repo.tags(['people', 'artists']);

      await tagged.put('John', 'value', 3600);
      const written = events.of(KeyWritten)[0] as any;
      expect(written.storeName).toBe('array');
      expect(written.value).toBe('value');
      expect(written.seconds).toBe(3600);
      expect(written.key).toMatch(/:John$/);
      expect(written.tags).toEqual(['people', 'artists']);

      expect(await tagged.get('John')).toBe('value');
      const hit = events.of(CacheHit)[0] as any;
      expect(hit.tags).toEqual(['people', 'artists']);
      expect(hit.value).toBe('value');

      await tagged.forget('John');
      expect(events.of(KeyForgotten)[0] as any).toMatchObject({ tags: ['people', 'artists'] });

      await tagged.flush();
      const flushed = events.of(CacheFlushed)[0] as any;
      expect(flushed.tags).toEqual(['people', 'artists']);
    });

    it('works on the Redis store with events', async () => {
      const client = new FakeRedisClient();
      const taggedEvents = new RecordingDispatcher();
      const redis = new Repository(new RedisStore({}, 'cache_', client), {}, taggedEvents).setStoreName('redis');

      const tagged = redis.tags('people');
      await tagged.put('Jane', 'value', 3600);

      expect(await tagged.get('Jane')).toBe('value');
      expect(taggedEvents.of(CacheHit)).toHaveLength(1);
      expect(taggedEvents.of(CacheHit)[0] as any).toMatchObject({ storeName: 'redis', tags: ['people'] });

      await tagged.flush();
      expect(await tagged.get('Jane')).toBeNull();
      expect(taggedEvents.of(CacheFlushed)).toHaveLength(1);
    });
  });
});
