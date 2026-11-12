/**
 * RedisDriver contract tests
 *
 * Exercises the QueueDriver contract (push/pop/release/delete/delayed/
 * clear/size) against RedisDriver using an in-memory Redis double that
 * emulates the driver's Lua scripts (see support/FakeRedisClient).
 *
 * The optional ioredis dependency and a Redis server are not required for
 * these tests; the double keeps the driver's semantics honest: atomic pop,
 * delayed jobs via a sorted set, and reserved jobs with a retry-after
 * deadline.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { QueueDriver } from '@/Queue/Contracts/QueueDriver';
import { RedisDriver, REDIS_POP_SCRIPT, REDIS_RELEASE_SCRIPT } from '@/Queue/Drivers/RedisDriver';
import { Job } from '@/Queue/Job';
import { FakeRedisClient } from './support/FakeRedisClient';

class RedisJob extends Job {
  public handled = false;
  public payloadValue: number;

  constructor(value: number = 1) {
    super();
    this.payloadValue = value;
  }

  async handle(): Promise<void> {
    this.handled = true;
  }
}

let client: FakeRedisClient;
let driver: RedisDriver;

function createDriver(overrides: Record<string, any> = {}): RedisDriver {
  return new RedisDriver(
    {
      driver: 'redis',
      queue: 'default',
      prefix: 'orchestr',
      retry_after: 90,
      ...overrides,
    },
    client
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  client = new FakeRedisClient();
  driver = createDriver();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The QueueDriver contract behaviours every driver must satisfy
 */
function runQueueDriverContract(name: string, make: () => QueueDriver): void {
  describe(`${name}: QueueDriver contract`, () => {
    let queue: QueueDriver;

    beforeEach(() => {
      queue = make();
    });

    it('push() queues a job that pop() returns in FIFO order with a readable payload', async () => {
      const first = new RedisJob(1);
      const second = new RedisJob(2);

      const idOne = await queue.push(first);
      const idTwo = await queue.push(second);

      expect(idOne).toBe(first.uuid);
      expect(idTwo).toBe(second.uuid);

      const poppedOne = await queue.pop();
      expect(poppedOne).not.toBeNull();
      expect(poppedOne!.id).toBe(idOne);
      expect(poppedOne!.queue).toBe('default');
      expect(poppedOne!.attempts).toBe(1);
      expect(poppedOne!.reservedAt).not.toBeNull();

      const poppedTwo = await queue.pop();
      expect(poppedTwo!.id).toBe(idTwo);

      expect(await queue.pop()).toBeNull();
    });

    it('pop() reserves a job so concurrent workers never share it', async () => {
      await queue.push(new RedisJob());

      const popped = await queue.pop();
      expect(popped).not.toBeNull();

      // The same job cannot be handed out twice
      expect(await queue.pop()).toBeNull();
    });

    it('release() puts a reserved job back onto the queue', async () => {
      await queue.push(new RedisJob());
      const popped = await queue.pop();
      expect(popped).not.toBeNull();

      await queue.release(popped!.id, 0);

      const repopped = await queue.pop();
      expect(repopped!.id).toBe(popped!.id);
      expect(repopped!.attempts).toBe(2);
    });

    it('release() honours the delay before the job becomes available again', async () => {
      await queue.push(new RedisJob());
      const popped = await queue.pop();

      await queue.release(popped!.id, 30);

      expect(await queue.pop()).toBeNull();

      vi.advanceTimersByTime(31_000);

      const repopped = await queue.pop();
      expect(repopped!.id).toBe(popped!.id);
      expect(repopped!.attempts).toBe(2);
    });

    it('later() hides delayed jobs until they are due', async () => {
      const job = new RedisJob(9);
      await queue.later(60, job);

      expect(await queue.pop()).toBeNull();

      vi.advanceTimersByTime(59_000);
      expect(await queue.pop()).toBeNull();

      vi.advanceTimersByTime(2_000);
      const popped = await queue.pop();
      expect(popped).not.toBeNull();
      expect(popped!.attempts).toBe(1);
    });

    it('later() accepts a Date as the availability moment', async () => {
      const when = new Date(Date.now() + 30_000);
      await queue.later(when, new RedisJob());

      expect(await queue.pop()).toBeNull();

      vi.advanceTimersByTime(31_000);
      expect(await queue.pop()).not.toBeNull();
    });

    it('delete() removes a job completely (reserved or queued)', async () => {
      const reserved = new RedisJob(1);
      const queued = new RedisJob(2);
      await queue.push(reserved);
      await queue.push(queued);

      const popped = await queue.pop();
      await queue.delete(popped!.id);

      await queue.delete(queued.uuid);

      expect(await queue.pop()).toBeNull();
      expect(await queue.size()).toBe(0);
    });

    it('size() counts jobs across states and clear() empties a queue', async () => {
      await queue.push(new RedisJob(1));
      await queue.push(new RedisJob(2));
      expect(await queue.size()).toBe(2);

      const popped = await queue.pop();
      expect(await queue.size()).toBe(2); // still counted while reserved

      const cleared = await queue.clear();
      expect(cleared).toBe(2);
      expect(await queue.size()).toBe(0);
      expect(await queue.pop()).toBeNull();
      expect(popped).not.toBeNull();
    });

    it('bulk() queues many jobs at once', async () => {
      const jobs = [new RedisJob(1), new RedisJob(2), new RedisJob(3)];
      await queue.bulk(jobs);

      expect(await queue.size()).toBe(3);

      for (const job of jobs) {
        const popped = await queue.pop();
        expect(popped!.id).toBe(job.uuid);
      }
    });

    it('uses named queues independently', async () => {
      await queue.push(new RedisJob(1), 'high');
      await queue.push(new RedisJob(2), 'low');

      expect(await queue.size('high')).toBe(1);
      expect(await queue.size('low')).toBe(1);

      const popped = await queue.pop('high');
      expect(popped!.queue).toBe('high');
      expect(await queue.pop('low')).not.toBeNull();
    });

    it('manages connection names and default queue resolution', () => {
      driver.setConnectionName('redis-testing');
      expect(driver.getConnectionName()).toBe('redis-testing');
      expect(driver.getQueue()).toBe('default');
      expect(driver.getQueue('emails')).toBe('emails');
    });
  });
}

runQueueDriverContract('RedisDriver', () => driver);

describe('RedisDriver internals', () => {
  it('performs the atomic pop through the Lua script', async () => {
    await driver.push(new RedisJob());

    const popped = await driver.pop();
    expect(popped).not.toBeNull();

    const popCall = client.evalCalls.find((call) => call.script === REDIS_POP_SCRIPT);
    expect(popCall).toBeDefined();
    expect(popCall!.keys).toEqual([
      'orchestr:default',
      'orchestr:default:delayed',
      'orchestr:default:reserved',
      'orchestr:payloads',
    ]);
  });

  it('performs release through the Lua script', async () => {
    const popped = (await driver.push(new RedisJob())) as string;
    await driver.pop();

    await driver.release(popped, 5);

    expect(client.evalCalls.some((call) => call.script === REDIS_RELEASE_SCRIPT)).toBe(true);
  });

  it('recovers reserved jobs whose retry-after deadline expired (crashed worker)', async () => {
    driver = createDriver({ retry_after: 10 });

    await driver.push(new RedisJob());
    const popped = await driver.pop();
    expect(popped).not.toBeNull();

    // The worker died without releasing; after retry_after another pop gets it back
    vi.advanceTimersByTime(11_000);

    const recovered = await driver.pop();
    expect(recovered!.id).toBe(popped!.id);
    expect(recovered!.attempts).toBe(2);
  });

  it('pushRaw() round-trips an arbitrary payload and derives the id', async () => {
    const rawPayload = JSON.stringify({ uuid: 'raw-123', job: 'SomeJob', data: {} });

    const id = await driver.pushRaw(rawPayload);
    expect(id).toBe('raw-123');

    const popped = await driver.pop();
    expect(popped!.id).toBe('raw-123');
    expect(popped!.payload).toBe(rawPayload);
  });

  it('pushRaw() generates an id for opaque payloads', async () => {
    const id = await driver.pushRaw('not-json');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);

    const popped = await driver.pop();
    expect(popped!.id).toBe(id);
  });

  it('uses the configured prefix for all keys', async () => {
    driver = createDriver({ prefix: 'myapp' });

    await driver.push(new RedisJob());
    await driver.pop();

    expect(client.lists.has('myapp:default')).toBe(true);
    expect(client.hashes.has('myapp:payloads')).toBe(true);
  });

  it('clear() only removes the targeted queue', async () => {
    await driver.push(new RedisJob(1), 'default');
    await driver.push(new RedisJob(2), 'default');
    await driver.push(new RedisJob(3), 'high');
    await driver.later(60, new RedisJob(4), 'default');

    const cleared = await driver.clear('default');
    expect(cleared).toBe(3);

    expect(await driver.size('default')).toBe(0);
    expect(await driver.size('high')).toBe(1);
  });

  it('disconnect() releases an injected client without error', async () => {
    await expect(driver.disconnect()).resolves.toBeUndefined();
  });

  it('reports no transaction connection (queue falls back to the default db)', () => {
    expect(driver.getTransactionConnection()).toBeNull();
  });
});
