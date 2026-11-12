/**
 * RedisStore
 *
 * Redis-backed cache store. Values are JSON-serialized under the store
 * key prefix, TTLs map onto Redis `SET ... EX` / `EXPIRE`, and atomic
 * counters use `INCRBY` / `DECRBY`.
 *
 * Lock support is provided at the store level through two Lua scripts so
 * `Cache.lock()` can never hand the same lock to two processes, and a
 * lock can only be released by its owner (mirroring Laravel's
 * Illuminate\Cache\RedisStore lock/release scripts).
 *
 * ioredis is an optional peer dependency: pass a `client` in the store
 * config (or the constructor) to control the connection yourself;
 * otherwise the store lazily `import('ioredis')` and connects with the
 * host/port/password/db options from the config.
 *
 * Mirrors Laravel's Illuminate\Cache\RedisStore.
 *
 * @example
 * ```typescript
 * const store = new RedisStore({ host: '127.0.0.1', port: 6379 }, 'app_');
 * await store.put('key', 'value', 3600);
 * const value = await store.get('key');
 * ```
 */

import type { LockContract } from '@/Cache/Contracts/Lock';
import type { AtomicLockStore, LockProvider } from '@/Cache/Contracts/LockProvider';
import type { Store } from '@/Cache/Contracts/Store';
import { RedisLock } from '@/Cache/Locks/RedisLock';

/**
 * Structural subset of an ioredis client used by this store. Declaring it
 * locally keeps `ioredis` a true optional dependency (no static import,
 * no compile-time type requirement) and allows injecting test doubles.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, ...options: (string | number)[]): Promise<'OK' | null>;
  mset(...keyValues: string[]): Promise<'OK'>;
  incrby(key: string, amount: number): Promise<number>;
  decrby(key: string, amount: number): Promise<number>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  persist(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
  scan(cursor: string, ...options: (string | number)[]): Promise<[string, string[]]>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<any>;
  quit?(): Promise<unknown>;
  disconnect?(): void;
}

/**
 * Atomic lock acquisition: refresh the TTL when the same owner already
 * holds the lock, otherwise claim it with `SET ... NX`. A single round
 * trip so two processes can never both acquire the same lock.
 */
export const REDIS_CACHE_LOCK_SCRIPT = `
local current = redis.call('GET', KEYS[1])

if current == ARGV[1] then
  local ttl = tonumber(ARGV[2])
  if ttl > 0 then return redis.call('EXPIRE', KEYS[1], ttl) end
  return 1
end

if not current then
  local ttl = tonumber(ARGV[2])
  local reply
  if ttl > 0 then
    reply = redis.call('SET', KEYS[1], ARGV[1], 'EX', ttl, 'NX')
  else
    reply = redis.call('SET', KEYS[1], ARGV[1], 'NX')
  end
  if reply then return 1 end
end

return 0
`;

/**
 * Atomic lock release: delete the lock only when it is still owned by
 * the given owner, so a process can never release another's lock.
 */
export const REDIS_CACHE_RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end

return 0
`;

/** Number of keys removed per DEL round trip during flush() */
const FLUSH_CHUNK_SIZE = 500;

export class RedisStore implements Store, LockProvider, AtomicLockStore {
  protected client: RedisClient | null;
  protected clientPromise: Promise<RedisClient> | null = null;

  constructor(
    protected config: Record<string, any> = {},
    protected prefix: string = '',
    client?: RedisClient
  ) {
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
   * using host/port/password/db/options from the store configuration.
   */
  protected async createRedisClient(): Promise<RedisClient> {
    const moduleName = 'ioredis';

    let ioredis: { Redis: new (options: Record<string, any>) => RedisClient };

    try {
      // Non-literal specifier: keeps ioredis a genuine optional dependency
      // that is never resolved (or type-checked) unless a redis cache
      // connection is actually used.
      ioredis = await import(moduleName);
    } catch {
      throw new Error(
        "The Redis cache store requires the 'ioredis' package. Install it with `npm install ioredis` " +
          'or provide a client instance via the store config.'
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

  // --- Store contract ---

  async get<T = any>(key: string): Promise<T | null> {
    const client = await this.getClient();
    const raw = await client.get(this.prefixedKey(key));

    if (raw === null || raw === undefined) {
      return null;
    }

    return this.unserialize<T>(raw);
  }

  async many<T = any>(keys: string[]): Promise<Record<string, T | null>> {
    const result: Record<string, T | null> = {};

    if (keys.length === 0) {
      return result;
    }

    const client = await this.getClient();
    const raws = await client.mget(...keys.map((key) => this.prefixedKey(key)));

    keys.forEach((key, index) => {
      const raw = raws[index];
      result[key] = raw === null || raw === undefined ? null : this.unserialize<T>(raw);
    });

    return result;
  }

  async put<T = any>(key: string, value: T, seconds: number): Promise<boolean> {
    if (seconds <= 0) {
      return this.forever(key, value);
    }

    const client = await this.getClient();
    const result = await client.set(this.prefixedKey(key), this.serialize(value), 'EX', Math.ceil(seconds));

    return result === 'OK';
  }

  async putMany<T = any>(values: Record<string, T>, seconds: number): Promise<boolean> {
    const entries = Object.entries(values);

    if (entries.length === 0) {
      return true;
    }

    const client = await this.getClient();

    if (seconds > 0) {
      const ttl = Math.ceil(seconds);

      for (const [key, value] of entries) {
        await client.set(this.prefixedKey(key), this.serialize(value), 'EX', ttl);
      }

      return true;
    }

    const pairs: string[] = [];

    for (const [key, value] of entries) {
      pairs.push(this.prefixedKey(key), this.serialize(value));
    }

    await client.mset(...pairs);

    return true;
  }

  async increment(key: string, value: number = 1): Promise<number | boolean> {
    const client = await this.getClient();

    try {
      return await client.incrby(this.prefixedKey(key), value);
    } catch {
      // A non-numeric payload cannot be incremented; drop the key so the
      // next attempt starts fresh (mirrors Laravel's RedisStore).
      await this.forget(key);
      return false;
    }
  }

  async decrement(key: string, value: number = 1): Promise<number | boolean> {
    const client = await this.getClient();

    try {
      return await client.decrby(this.prefixedKey(key), value);
    } catch {
      await this.forget(key);
      return false;
    }
  }

  async forever<T = any>(key: string, value: T): Promise<boolean> {
    const client = await this.getClient();
    const prefixed = this.prefixedKey(key);
    const result = await client.set(prefixed, this.serialize(value));

    if (result !== 'OK') {
      return false;
    }

    await client.persist(prefixed);

    return true;
  }

  async add<T = any>(key: string, value: T, seconds: number): Promise<boolean> {
    const client = await this.getClient();

    const result =
      seconds > 0
        ? await client.set(this.prefixedKey(key), this.serialize(value), 'EX', Math.ceil(seconds), 'NX')
        : await client.set(this.prefixedKey(key), this.serialize(value), 'NX');

    return result === 'OK';
  }

  async forget(key: string): Promise<boolean> {
    const client = await this.getClient();
    return (await client.del(this.prefixedKey(key))) > 0;
  }

  async flush(): Promise<boolean> {
    const client = await this.getClient();
    const pattern = `${escapeGlob(this.prefix)}*`;

    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', FLUSH_CHUNK_SIZE);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    for (let index = 0; index < keys.length; index += FLUSH_CHUNK_SIZE) {
      await client.del(...keys.slice(index, index + FLUSH_CHUNK_SIZE));
    }

    return true;
  }

  getPrefix(): string {
    return this.prefix;
  }

  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  /**
   * Extend the lifetime of a key without touching its value.
   * A null `seconds` removes any existing TTL (store forever).
   */
  async touch(key: string, seconds: number | null): Promise<boolean> {
    const client = await this.getClient();
    const prefixed = this.prefixedKey(key);

    if (seconds !== null && seconds > 0) {
      return (await client.expire(prefixed, Math.ceil(seconds))) === 1;
    }

    await client.persist(prefixed);

    return (await client.exists(prefixed)) === 1;
  }

  /**
   * Remaining TTL in seconds: -1 when stored forever, -2 when missing
   * (the raw Redis TTL semantics).
   */
  async ttl(key: string): Promise<number> {
    const client = await this.getClient();
    return client.ttl(this.prefixedKey(key));
  }

  // --- LockProvider / AtomicLockStore ---

  /**
   * Get an atomic lock for the given name
   */
  lock(name: string, seconds: number = 0, owner?: string): LockContract {
    return new RedisLock(this, name, seconds, owner);
  }

  /**
   * Restore a lock instance using the original owner identifier
   */
  restoreLock(name: string, owner: string): LockContract {
    return new RedisLock(this, name, 0, owner);
  }

  /**
   * Atomically acquire (or refresh, when already owned) the lock
   */
  async acquireLock(name: string, seconds: number, owner: string): Promise<boolean> {
    const client = await this.getClient();

    const result = await client.eval(
      REDIS_CACHE_LOCK_SCRIPT,
      1,
      this.prefixedKey(name),
      owner,
      Math.max(0, Math.ceil(seconds))
    );

    return Number(result) === 1;
  }

  /**
   * Atomically release the lock only when the owner still matches
   */
  async releaseLock(name: string, owner: string): Promise<boolean> {
    const client = await this.getClient();

    const result = await client.eval(REDIS_CACHE_RELEASE_SCRIPT, 1, this.prefixedKey(name), owner);

    return Number(result) > 0;
  }

  /**
   * Release the lock regardless of ownership
   */
  async forceReleaseLock(name: string): Promise<boolean> {
    return this.forget(name);
  }

  /**
   * Read the raw owner value of the lock (no deserialization)
   */
  async getLockOwner(name: string): Promise<string | null> {
    const client = await this.getClient();
    const raw = await client.get(this.prefixedKey(name));

    return raw === undefined ? null : raw;
  }

  // --- Internals ---

  protected prefixedKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  protected serialize(value: any): string {
    return JSON.stringify(value);
  }

  protected unserialize<T = any>(raw: string): T {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }
}

/**
 * Escape Redis glob metacharacters in the configured prefix so flush()
 * matches exactly the keys this store owns.
 */
function escapeGlob(value: string): string {
  return value.replace(/([*?[\]\\])/g, '\\$1');
}
