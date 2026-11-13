/**
 * In-memory Redis client test double for the cache store
 *
 * Implements the string/keyspace command subset used by RedisStore and
 * emulates the two lock Lua scripts shipped with the store in JavaScript
 * with identical semantics (see tests/Queue/support/FakeRedisClient for
 * the same pattern on the queue side). This keeps the cache store
 * contract tests running without a Redis server or the optional ioredis
 * dependency.
 *
 * If the Lua scripts change, update emulateLock/emulateRelease
 * accordingly: the fidelity of these emulations is what makes the
 * contract tests meaningful.
 */

import { REDIS_CACHE_LOCK_SCRIPT, REDIS_CACHE_RELEASE_SCRIPT, type RedisClient } from '@/Cache/Stores/RedisStore';

interface StringEntry {
  value: string;
  /** Absolute expiry in unix seconds, or null when the key lives forever */
  expireAt: number | null;
}

function escapeRegExp(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class FakeRedisClient implements RedisClient {
  strings: Map<string, StringEntry> = new Map();

  /** Count of eval invocations, for asserting the atomic scripts are used */
  evalCalls: Array<{ script: string; keys: string[]; argv: (string | number)[] }> = [];

  // --- Strings ---

  async get(key: string): Promise<string | null> {
    return this.read(key);
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    return keys.map((key) => this.read(key));
  }

  async set(key: string, value: string, ...options: (string | number)[]): Promise<'OK' | null> {
    let expireAt: number | null = null;
    let nx = false;
    let xx = false;

    for (let index = 0; index < options.length; index++) {
      const option = String(options[index]).toUpperCase();

      if (option === 'EX') {
        expireAt = this.now() + Number(options[++index]);
      } else if (option === 'PX') {
        expireAt = this.now() + Math.ceil(Number(options[++index]) / 1000);
      } else if (option === 'NX') {
        nx = true;
      } else if (option === 'XX') {
        xx = true;
      }
    }

    const exists = this.read(key) !== null;

    if ((nx && exists) || (xx && !exists)) {
      return null;
    }

    this.strings.set(key, { value, expireAt });

    return 'OK';
  }

  async mset(...keyValues: string[]): Promise<'OK'> {
    for (let index = 0; index < keyValues.length; index += 2) {
      this.strings.set(keyValues[index], { value: keyValues[index + 1], expireAt: null });
    }

    return 'OK';
  }

  async incrby(key: string, amount: number): Promise<number> {
    const current = this.read(key);

    if (current !== null && !/^-?\d+$/.test(current)) {
      throw new Error('ERR value is not an integer or out of range');
    }

    return this.writeCounter(key, (current === null ? 0 : Number(current)) + amount);
  }

  async decrby(key: string, amount: number): Promise<number> {
    return this.incrby(key, -amount);
  }

  // --- Keyspace ---

  async del(...keys: string[]): Promise<number> {
    let removed = 0;

    for (const key of keys) {
      if (this.strings.delete(key)) {
        removed++;
      }
    }

    return removed;
  }

  async exists(...keys: string[]): Promise<number> {
    return keys.reduce((count, key) => count + (this.read(key) !== null ? 1 : 0), 0);
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.entry(key);

    if (!entry) {
      return 0;
    }

    entry.expireAt = this.now() + seconds;

    return 1;
  }

  async persist(key: string): Promise<number> {
    const entry = this.entry(key);

    if (!entry || entry.expireAt === null) {
      return 0;
    }

    entry.expireAt = null;

    return 1;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.entry(key);

    if (!entry) {
      return -2;
    }

    return entry.expireAt === null ? -1 : entry.expireAt - this.now();
  }

  async scan(cursor: string, ...options: (string | number)[]): Promise<[string, string[]]> {
    let pattern = '*';

    for (let index = 0; index < options.length; index++) {
      if (String(options[index]).toUpperCase() === 'MATCH') {
        pattern = String(options[index + 1]);
        index++;
      }
    }

    const matcher = this.globToRegExp(pattern);
    const keys: string[] = [];

    for (const key of Array.from(this.strings.keys())) {
      if (this.read(key) !== null && matcher.test(key)) {
        keys.push(key);
      }
    }

    // A single pass: everything is returned on the first call.
    return ['0', keys];
  }

  // --- Scripts ---

  async eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<any> {
    const keys = args.slice(0, numKeys).map(String);
    const argv = args.slice(numKeys);

    this.evalCalls.push({ script, keys, argv });

    if (script === REDIS_CACHE_LOCK_SCRIPT) {
      return this.emulateLock(keys, argv);
    }

    if (script === REDIS_CACHE_RELEASE_SCRIPT) {
      return this.emulateRelease(keys, argv);
    }

    throw new Error('FakeRedisClient received an unknown Lua script');
  }

  /**
   * JavaScript mirror of REDIS_CACHE_LOCK_SCRIPT.
   * KEYS: lock key. ARGV: owner, seconds.
   */
  protected emulateLock(keys: string[], argv: (string | number)[]): number {
    const [key] = keys;
    const owner = String(argv[0]);
    const ttl = Number(argv[1]);
    const current = this.read(key);

    if (current === owner) {
      if (ttl > 0) {
        const entry = this.strings.get(key);
        if (entry) entry.expireAt = this.now() + ttl;
      }

      return 1;
    }

    if (current === null) {
      this.strings.set(key, { value: owner, expireAt: ttl > 0 ? this.now() + ttl : null });

      return 1;
    }

    return 0;
  }

  /**
   * JavaScript mirror of REDIS_CACHE_RELEASE_SCRIPT.
   * KEYS: lock key. ARGV: owner.
   */
  protected emulateRelease(keys: string[], argv: (string | number)[]): number {
    const [key] = keys;
    const owner = String(argv[0]);

    if (this.read(key) === owner) {
      this.strings.delete(key);

      return 1;
    }

    return 0;
  }

  // --- Internal helpers ---

  protected now(): number {
    return Math.floor(Date.now() / 1000);
  }

  /** Live entry or undefined; deletes (and reports) expired keys lazily */
  protected entry(key: string): StringEntry | undefined {
    const entry = this.strings.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expireAt !== null && this.now() >= entry.expireAt) {
      this.strings.delete(key);

      return undefined;
    }

    return entry;
  }

  protected read(key: string): string | null {
    return this.entry(key)?.value ?? null;
  }

  protected writeCounter(key: string, value: number): number {
    const existing = this.strings.get(key);

    this.strings.set(key, { value: String(value), expireAt: existing?.expireAt ?? null });

    return value;
  }

  protected globToRegExp(pattern: string): RegExp {
    let source = '';

    for (let index = 0; index < pattern.length; index++) {
      const char = pattern[index];

      if (char === '\\') {
        source += escapeRegExp(pattern[++index] ?? '');
      } else if (char === '*') {
        source += '.*';
      } else if (char === '?') {
        source += '.';
      } else {
        source += escapeRegExp(char);
      }
    }

    return new RegExp(`^${source}$`);
  }

  async quit(): Promise<unknown> {
    return 'OK';
  }

  disconnect(): void {
    // no-op
  }
}
