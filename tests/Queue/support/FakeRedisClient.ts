/**
 * In-memory Redis client test double
 *
 * Implements the command subset used by RedisDriver (lists, sorted sets,
 * hashes, eval) and emulates the two Lua scripts shipped with the driver in
 * JavaScript with identical semantics. This lets the QueueDriver contract
 * tests run against RedisDriver without a Redis server or the optional
 * ioredis dependency.
 *
 * If the Lua scripts change, update emulatePop/emulateRelease accordingly:
 * the fidelity of these emulations is what makes the contract tests
 * meaningful.
 */

import { REDIS_POP_SCRIPT, REDIS_RELEASE_SCRIPT, type RedisClient } from '@/Queue/Drivers/RedisDriver';

type List = string[];
type ZSet = Map<string, number>;
type Hash = Map<string, string>;

function parseScore(value: number | string): number {
  if (typeof value === 'number') {
    return value;
  }

  if (value === '-inf') return -Infinity;
  if (value === '+inf' || value === 'inf') return Infinity;

  return Number(value);
}

export class FakeRedisClient implements RedisClient {
  lists: Map<string, List> = new Map();
  zsets: Map<string, ZSet> = new Map();
  hashes: Map<string, Hash> = new Map();

  /** Count of eval invocations, for asserting the atomic scripts are used */
  evalCalls: Array<{ script: string; keys: string[]; argv: (string | number)[] }> = [];

  // --- Lists ---

  async lpush(key: string, value: string): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.unshift(value);
    this.lists.set(key, list);

    return list.length;
  }

  async rpop(key: string): Promise<string | null> {
    const list = this.lists.get(key);

    if (!list || list.length === 0) {
      return null;
    }

    return list.pop() ?? null;
  }

  async llen(key: string): Promise<number> {
    return this.lists.get(key)?.length ?? 0;
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const list = this.lists.get(key) ?? [];
    const end = stop === -1 ? list.length : stop + 1;

    return list.slice(start, end);
  }

  async lrem(key: string, _count: number, value: string): Promise<number> {
    const list = this.lists.get(key) ?? [];
    const remaining = list.filter((item) => item !== value);
    const removed = list.length - remaining.length;

    if (remaining.length === 0) {
      this.lists.delete(key);
    } else {
      this.lists.set(key, remaining);
    }

    return removed;
  }

  // --- Sorted sets ---

  async zadd(key: string, score: number, member: string): Promise<number> {
    const set = this.zsets.get(key) ?? new Map();
    const isNew = !set.has(member);
    set.set(member, score);
    this.zsets.set(key, set);

    return isNew ? 1 : 0;
  }

  async zrem(key: string, member: string): Promise<number> {
    const set = this.zsets.get(key);

    if (!set || !set.has(member)) {
      return 0;
    }

    set.delete(member);

    return 1;
  }

  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }

  async zrangebyscore(key: string, min: number | string, max: number | string, ...args: any[]): Promise<string[]> {
    const set = this.zsets.get(key);

    if (!set) {
      return [];
    }

    const lo = parseScore(min);
    const hi = parseScore(max);

    let members = Array.from(set.entries())
      .filter(([, score]) => score >= lo && score <= hi)
      .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
      .map(([member]) => member);

    // Support `LIMIT offset count`
    const limitIndex = args.findIndex((arg) => String(arg).toLowerCase() === 'limit');

    if (limitIndex !== -1) {
      const offset = Number(args[limitIndex + 1]) || 0;
      const count = Number(args[limitIndex + 2]);

      members = Number.isNaN(count) ? members.slice(offset) : members.slice(offset, offset + count);
    }

    return members;
  }

  // --- Hashes ---

  async hset(key: string, field: string, value: string): Promise<number> {
    const hash = this.hashes.get(key) ?? new Map();
    const isNew = !hash.has(field);
    hash.set(field, value);
    this.hashes.set(key, hash);

    return isNew ? 1 : 0;
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    const hash = this.hashes.get(key);

    if (!hash) {
      return 0;
    }

    let removed = 0;

    for (const field of fields) {
      if (hash.delete(field)) {
        removed++;
      }
    }

    return removed;
  }

  // --- Keyspace ---

  async del(...keys: string[]): Promise<number> {
    let removed = 0;

    for (const key of keys) {
      if (this.lists.delete(key)) removed++;
      if (this.zsets.delete(key)) removed++;
      if (this.hashes.delete(key)) removed++;
    }

    return removed;
  }

  // --- Scripts ---

  async eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<any> {
    const keys = args.slice(0, numKeys).map(String);
    const argv = args.slice(numKeys);

    this.evalCalls.push({ script, keys, argv });

    if (script === REDIS_POP_SCRIPT) {
      return this.emulatePop(keys, argv);
    }

    if (script === REDIS_RELEASE_SCRIPT) {
      return this.emulateRelease(keys, argv);
    }

    throw new Error('FakeRedisClient received an unknown Lua script');
  }

  /**
   * JavaScript mirror of REDIS_POP_SCRIPT.
   * KEYS: available, delayed, reserved, payloads. ARGV: now, retryUntil.
   */
  protected emulatePop(keys: string[], argv: (string | number)[]): string | null {
    const [availableKey, delayedKey, reservedKey, payloadsKey] = keys;
    const now = Number(argv[0]);
    const retryUntil = Number(argv[1]);

    // Promote a due delayed job when nothing is immediately available
    const available = this.lists.get(availableKey);

    if (!available || available.length === 0) {
      const due = this.sortOfZRangeByScore(delayedKey, -Infinity, now, 1);

      if (due.length > 0) {
        this.zsets.get(delayedKey)?.delete(due[0]);
        this.pushToAvailable(availableKey, due[0]);
      }
    }

    // Recover expired reserved jobs
    const expired = this.sortOfZRangeByScore(reservedKey, -Infinity, now);

    for (const id of expired) {
      this.zsets.get(reservedKey)?.delete(id);
      this.pushToAvailable(availableKey, id);
    }

    const id = this.popFromAvailable(availableKey);

    if (id === null) {
      return null;
    }

    const raw = this.hashes.get(payloadsKey)?.get(id);

    if (!raw) {
      return null;
    }

    const meta = JSON.parse(raw);
    meta.attempts = (meta.attempts ?? 0) + 1;
    meta.reservedAt = now;

    this.hashes.get(payloadsKey)!.set(id, JSON.stringify(meta));

    this.zaddSync(reservedKey, retryUntil, id);

    return JSON.stringify(meta);
  }

  /**
   * JavaScript mirror of REDIS_RELEASE_SCRIPT.
   * KEYS: reserved, delayed, available, payloads. ARGV: id, availableAt, now.
   */
  protected emulateRelease(keys: string[], argv: (string | number)[]): number {
    const [reservedKey, delayedKey, availableKey, payloadsKey] = keys;
    const id = String(argv[0]);
    const availableAt = Number(argv[1]);
    const now = Number(argv[2]);

    const raw = this.hashes.get(payloadsKey)?.get(id);

    if (!raw) {
      return 0;
    }

    this.zsets.get(reservedKey)?.delete(id);
    this.zsets.get(delayedKey)?.delete(id);

    const meta = JSON.parse(raw);
    delete meta.reservedAt;
    meta.availableAt = availableAt;

    this.hashes.get(payloadsKey)!.set(id, JSON.stringify(meta));

    if (availableAt <= now) {
      this.pushToAvailable(availableKey, id);
    } else {
      this.zaddSync(delayedKey, availableAt, id);
    }

    return 1;
  }

  // --- Internal synchronous helpers shared with the script emulations ---

  protected pushToAvailable(key: string, id: string): void {
    const list = this.lists.get(key) ?? [];
    list.unshift(id);
    this.lists.set(key, list);
  }

  protected popFromAvailable(key: string): string | null {
    const list = this.lists.get(key);

    if (!list || list.length === 0) {
      return null;
    }

    return list.pop() ?? null;
  }

  protected zaddSync(key: string, score: number, member: string): void {
    const set = this.zsets.get(key) ?? new Map();
    set.set(member, score);
    this.zsets.set(key, set);
  }

  protected sortOfZRangeByScore(key: string, lo: number, hi: number, limit?: number): string[] {
    const set = this.zsets.get(key);

    if (!set) {
      return [];
    }

    const members = Array.from(set.entries())
      .filter(([, score]) => score >= lo && score <= hi)
      .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
      .map(([member]) => member);

    return limit === undefined ? members : members.slice(0, limit);
  }
}
