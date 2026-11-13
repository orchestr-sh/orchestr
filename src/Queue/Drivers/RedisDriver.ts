/**
 * RedisDriver
 *
 * Production-grade Redis queue driver backed by an ioredis-compatible
 * client. Jobs are stored in per-queue lists, delayed jobs in a sorted
 * set, and in-flight jobs in a sorted set scored by their retry-after
 * deadline so crashed workers release them automatically.
 *
 * Key layout (prefix defaults to `orchestr`):
 * - `{prefix}:{queue}`            list  - available job ids (LPUSH / RPOP, FIFO)
 * - `{prefix}:{queue}:delayed`    zset  - job id -> available-at unix time
 * - `{prefix}:{queue}:reserved`   zset  - job id -> retry-after deadline
 * - `{prefix}:payloads`           hash  - job id -> serialized envelope
 *
 * Popping (including promoting due delayed jobs and recovering expired
 * reserved jobs) runs as a single Lua script so a job can never be handed
 * to two workers.
 *
 * ioredis is an optional peer dependency: pass a `client` in the
 * connection config (or inject one via the constructor) to control the
 * connection yourself; otherwise the driver lazily `import('ioredis')`
 * and connects with the host/port/password/db options from the config.
 *
 * Mirrors Laravel's Illuminate\Queue\RedisQueue.
 */

import { randomUUID } from 'crypto';
import type { QueueDriver, QueueDriverJob, TransactionAwareConnection } from '@/Queue/Contracts/QueueDriver';
import type { Job } from '@/Queue/Job';
import type { QueueConnectionConfig } from '@/Queue/QueueManager';
import { JobPayload } from '@/Queue/JobPayload';

/**
 * Structural subset of an ioredis client used by this driver. Declaring it
 * locally keeps `ioredis` a true optional dependency (no static import,
 * no compile-time type requirement) and allows injecting test doubles.
 */
export interface RedisClient {
  lpush(key: string, value: string): Promise<number>;
  rpop(key: string): Promise<string | null>;
  llen(key: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  lrem(key: string, count: number, value: string): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrem(key: string, member: string): Promise<number>;
  zcard(key: string): Promise<number>;
  zrangebyscore(key: string, min: number | string, max: number | string, ...args: any[]): Promise<string[]>;
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  del(...keys: string[]): Promise<number>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<any>;
  quit?(): Promise<unknown>;
  disconnect?(): void;
}

/**
 * Envelope stored in the payloads hash. Keeps the queue association and
 * attempt counter outside the job payload itself so release()/delete()
 * work with only a job id (per the QueueDriver contract).
 */
interface RedisJobEnvelope {
  id: string;
  queue: string;
  payload: string;
  attempts: number;
  reservedAt: number | null;
  availableAt: number;
  createdAt: number;
}

/**
 * Atomic pop: promote a due delayed job when the list is empty, recover
 * expired reserved jobs past their retry-after deadline, then reserve the
 * next job by moving it into the reserved set and bumping its attempt
 * counter - all in one round trip so concurrent workers never share a job.
 */
export const REDIS_POP_SCRIPT = `
local now = tonumber(ARGV[1])
local retryUntil = tonumber(ARGV[2])

if redis.call('llen', KEYS[1]) == 0 then
  local due = redis.call('zrangebyscore', KEYS[2], '-inf', now, 'limit', 0, 1)
  if #due > 0 then
    redis.call('zrem', KEYS[2], due[1])
    redis.call('lpush', KEYS[1], due[1])
  end
end

local expired = redis.call('zrangebyscore', KEYS[3], '-inf', now)
for i = 1, #expired do
  redis.call('zrem', KEYS[3], expired[i])
  redis.call('lpush', KEYS[1], expired[i])
end

local id = redis.call('rpop', KEYS[1])
if not id then
  return nil
end

local raw = redis.call('hget', KEYS[4], id)
if not raw then
  return nil
end

local meta = cjson.decode(raw)
meta.attempts = (meta.attempts or 0) + 1
meta.reservedAt = now
redis.call('hset', KEYS[4], id, cjson.encode(meta))
redis.call('zadd', KEYS[3], retryUntil, id)

return cjson.encode(meta)
`;

/**
 * Atomic release: un-reserve a job and re-queue it immediately (list) or
 * at a future time (delayed set), refreshing its stored envelope.
 */
export const REDIS_RELEASE_SCRIPT = `
local id = ARGV[1]
local availableAt = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local raw = redis.call('hget', KEYS[4], id)
if not raw then
  return 0
end

redis.call('zrem', KEYS[1], id)
redis.call('zrem', KEYS[2], id)

local meta = cjson.decode(raw)
meta.reservedAt = nil
meta.availableAt = availableAt
redis.call('hset', KEYS[4], id, cjson.encode(meta))

if availableAt <= now then
  redis.call('lpush', KEYS[3], id)
else
  redis.call('zadd', KEYS[2], availableAt, id)
end

return 1
`;

function toUnixSeconds(delay: number | Date): number {
  const now = Math.floor(Date.now() / 1000);

  if (delay instanceof Date) {
    return Math.floor(delay.getTime() / 1000);
  }

  return now + Math.max(0, Math.floor(delay));
}

export class RedisDriver implements QueueDriver {
  protected connectionName: string = 'redis';
  protected defaultQueue: string;
  protected prefix: string;
  protected retryAfter: number;
  protected client: RedisClient | null;
  protected clientPromise: Promise<RedisClient> | null = null;

  constructor(
    protected config: QueueConnectionConfig,
    client?: RedisClient
  ) {
    this.defaultQueue = config.queue || 'default';
    this.prefix = config.prefix || 'orchestr';
    this.retryAfter = config.retry_after || 90;
    this.client = client ?? (config.client as RedisClient | undefined) ?? null;
  }

  /**
   * Resolve the underlying client, lazily connecting through ioredis when
   * no client instance was provided.
   */
  protected async getClient(): Promise<RedisClient> {
    if (this.client) {
      return this.client;
    }

    if (!this.clientPromise) {
      this.clientPromise = this.createRedisClient();
    }

    this.client = await this.clientPromise;

    return this.client;
  }

  /**
   * Dynamically import the optional ioredis peer dependency and connect
   * using host/port/password/db/options from the queue connection config.
   */
  protected async createRedisClient(): Promise<RedisClient> {
    const moduleName = 'ioredis';

    let ioredis: { Redis: new (options: Record<string, any>) => RedisClient };

    try {
      // Non-literal specifier: keeps ioredis a genuine optional dependency
      // that is never resolved (or type-checked) unless a redis connection
      // is actually used.
      ioredis = await import(moduleName);
    } catch {
      throw new Error(
        "The Redis queue driver requires the 'ioredis' package. Install it with `npm install ioredis` " +
          'or provide a client instance via the connection config.'
      );
    }

    return new ioredis.Redis({
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      db: this.config.db,
      ...(this.config.options || {}),
    });
  }

  /**
   * Close the underlying connection (no-op when not connected)
   */
  async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    const client = this.client;
    this.client = null;
    this.clientPromise = null;

    if (typeof client.quit === 'function') {
      await client.quit();
    } else if (typeof client.disconnect === 'function') {
      client.disconnect();
    }
  }

  // --- Key helpers ---

  protected availableKey(queue: string): string {
    return `${this.prefix}:${queue}`;
  }

  protected delayedKey(queue: string): string {
    return `${this.prefix}:${queue}:delayed`;
  }

  protected reservedKey(queue: string): string {
    return `${this.prefix}:${queue}:reserved`;
  }

  protected payloadsKey(): string {
    return `${this.prefix}:payloads`;
  }

  // --- QueueDriver contract ---

  async size(queue?: string): Promise<number> {
    const client = await this.getClient();
    const queueName = this.getQueue(queue);

    const [available, delayed, reserved] = await Promise.all([
      client.llen(this.availableKey(queueName)),
      client.zcard(this.delayedKey(queueName)),
      client.zcard(this.reservedKey(queueName)),
    ]);

    return available + delayed + reserved;
  }

  async push(job: Job, queue?: string): Promise<string> {
    const client = await this.getClient();
    const queueName = this.getQueue(queue);
    const payload = JobPayload.create(job);
    const now = Math.floor(Date.now() / 1000);

    const envelope: RedisJobEnvelope = {
      id: payload.uuid,
      queue: queueName,
      payload: JobPayload.serialize(payload),
      attempts: 0,
      reservedAt: null,
      availableAt: now,
      createdAt: now,
    };

    await client.hset(this.payloadsKey(), envelope.id, JSON.stringify(envelope));
    await client.lpush(this.availableKey(queueName), envelope.id);

    return payload.uuid;
  }

  async pushRaw(payload: string, queue?: string, options?: Record<string, any>): Promise<string> {
    const client = await this.getClient();
    const queueName = this.getQueue(queue);
    const now = Math.floor(Date.now() / 1000);

    let id: string;

    try {
      id = JobPayload.deserialize(payload).uuid || randomUUID();
    } catch {
      id = randomUUID();
    }

    const availableAt = options?.delay ? now + Math.floor(options.delay) : now;

    const envelope: RedisJobEnvelope = {
      id,
      queue: queueName,
      payload,
      attempts: 0,
      reservedAt: null,
      availableAt,
      createdAt: now,
    };

    await client.hset(this.payloadsKey(), id, JSON.stringify(envelope));

    if (availableAt > now) {
      await client.zadd(this.delayedKey(queueName), availableAt, id);
    } else {
      await client.lpush(this.availableKey(queueName), id);
    }

    return id;
  }

  async later(delay: number | Date, job: Job, queue?: string): Promise<string> {
    const client = await this.getClient();
    const queueName = this.getQueue(queue);
    const payload = JobPayload.create(job);
    const now = Math.floor(Date.now() / 1000);
    const availableAt = delay instanceof Date ? toUnixSeconds(delay) : now + Math.max(0, Math.floor(delay));

    const envelope: RedisJobEnvelope = {
      id: payload.uuid,
      queue: queueName,
      payload: JobPayload.serialize(payload),
      attempts: 0,
      reservedAt: null,
      availableAt,
      createdAt: now,
    };

    await client.hset(this.payloadsKey(), envelope.id, JSON.stringify(envelope));
    await client.zadd(this.delayedKey(queueName), availableAt, envelope.id);

    return payload.uuid;
  }

  async bulk(jobs: Job[], queue?: string): Promise<void> {
    for (const job of jobs) {
      await this.push(job, queue);
    }
  }

  async pop(queue?: string): Promise<QueueDriverJob | null> {
    const client = await this.getClient();
    const queueName = this.getQueue(queue);
    const now = Math.floor(Date.now() / 1000);
    const retryUntil = now + this.retryAfter;

    const result = await client.eval(
      REDIS_POP_SCRIPT,
      4,
      this.availableKey(queueName),
      this.delayedKey(queueName),
      this.reservedKey(queueName),
      this.payloadsKey(),
      now,
      retryUntil
    );

    if (!result) {
      return null;
    }

    let envelope: RedisJobEnvelope;

    try {
      envelope = JSON.parse(result as string);
    } catch {
      console.error(`[Queue] Redis driver returned an unreadable envelope for queue [${queueName}]`);
      return null;
    }

    return {
      id: envelope.id,
      queue: envelope.queue,
      payload: envelope.payload,
      attempts: envelope.attempts,
      reservedAt: envelope.reservedAt,
      availableAt: envelope.availableAt,
      createdAt: envelope.createdAt,
    };
  }

  async release(id: string, delay: number = 0): Promise<void> {
    const client = await this.getClient();
    const queueName = await this.queueForId(client, id);

    if (!queueName) {
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const availableAt = now + Math.max(0, Math.floor(delay));

    await client.eval(
      REDIS_RELEASE_SCRIPT,
      4,
      this.reservedKey(queueName),
      this.delayedKey(queueName),
      this.availableKey(queueName),
      this.payloadsKey(),
      id,
      availableAt,
      now
    );
  }

  async delete(id: string): Promise<void> {
    const client = await this.getClient();
    const queueName = await this.queueForId(client, id);

    await client.hdel(this.payloadsKey(), id);

    if (!queueName) {
      return;
    }

    await client.lrem(this.availableKey(queueName), 0, id);
    await client.zrem(this.delayedKey(queueName), id);
    await client.zrem(this.reservedKey(queueName), id);
  }

  async clear(queue?: string): Promise<number> {
    const client = await this.getClient();
    const queueName = this.getQueue(queue);

    const available = await client.lrange(this.availableKey(queueName), 0, -1);
    const delayed = await client.zrangebyscore(this.delayedKey(queueName), '-inf', '+inf');
    const reserved = await client.zrangebyscore(this.reservedKey(queueName), '-inf', '+inf');

    const ids = Array.from(new Set([...available, ...delayed, ...reserved]));

    await client.del(this.availableKey(queueName), this.delayedKey(queueName), this.reservedKey(queueName));

    if (ids.length > 0) {
      await client.hdel(this.payloadsKey(), ...ids);
    }

    return ids.length;
  }

  getConnectionName(): string {
    return this.connectionName;
  }

  setConnectionName(name: string): void {
    this.connectionName = name;
  }

  getQueue(queue?: string): string {
    return queue || this.defaultQueue;
  }

  /**
   * The transaction system does not cover Redis queues; fall back to the
   * application default connection by returning null (the QueueManager
   * handles the fallback through the container).
   */
  getTransactionConnection(): TransactionAwareConnection | null {
    return null;
  }

  /**
   * Look up which queue an id belongs to via the stored envelope
   */
  protected async queueForId(client: RedisClient, id: string): Promise<string | null> {
    const raw = await client.hget(this.payloadsKey(), id);

    if (!raw) {
      return null;
    }

    try {
      return (JSON.parse(raw) as RedisJobEnvelope).queue;
    } catch {
      return null;
    }
  }
}
