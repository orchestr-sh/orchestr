/**
 * RateLimiter - the cache-backed request/job rate limiter
 * Illuminate\Cache\RateLimiter
 *
 * All rate-limit state lives here (SRP): hit counters and window timers are
 * plain cache keys, so any store the CacheManager can build (array, file,
 * database, redis) backs the limiter without extra plumbing. The `throttle`
 * middleware and the queue's `RateLimited` job middleware both drive this
 * same service, and named limiters registered through `define()` are looked
 * up here too - middleware never hard-codes limit definitions (OCP).
 *
 * @example
 * ```typescript
 * const limiter = app.make<RateLimiter>('limiter');
 *
 * if (await limiter.tooManyAttempts('send-message:' + userId, 5)) {
 *   return `Try again in ${await limiter.availableIn('send-message:' + userId)}s`;
 * }
 *
 * await limiter.hit('send-message:' + userId, 5);
 * ```
 */

import type { Request } from '@/Routing/Request';
import type { ResponseObject } from '@/Routing/Responses/ResponseObject';
import type { Limit } from './RateLimiting/Limit';
import type { Unlimited } from './RateLimiting/Unlimited';

/**
 * The cache surface the limiter needs - Repository satisfies it, and tests
 * can hand in anything with these six verbs
 */
export interface RateLimiterCache {
  get<T = any>(key: string, defaultValue?: T | (() => T)): Promise<T | null>;
  put<T = any>(key: string, value: T, ttl?: number | Date): Promise<boolean>;
  add<T = any>(key: string, value: T, ttl?: number | Date): Promise<boolean>;
  has(key: string): Promise<boolean>;
  increment(key: string, value?: number): Promise<number | boolean>;
  forget(key: string): Promise<boolean>;
}

/**
 * Everything a named limiter callback may answer the request with: one or
 * more limit definitions, the Unlimited exemption marker, or a response
 * object that short-circuits the pipeline outright
 * Laravel: Limit | Limit[] | Unlimited | Response from a limiter closure
 */
export type NamedLimiterResult = Limit | Limit[] | Unlimited | ResponseObject;

/**
 * The callback behind a named limiter; receives the running request and
 * returns one limit, a list of limits, or Unlimited to skip throttling
 * Laravel: RateLimiter::for('api', fn (Request $r) => Limit::perMinute(60))
 */
export type NamedLimiterCallback = (request: Request) => NamedLimiterResult | Promise<NamedLimiterResult>;

/**
 * Everything `RateLimiter::for()` bundles for one key: the limiter, the
 * bucket key, and the window this key is judged against
 */
export class Limited {
  constructor(
    /**
     * The limiter holding this key's counters
     */
    public readonly limiter: RateLimiter,

    /**
     * The rate limiter key
     */
    public readonly key: string,

    /**
     * The maximum number of attempts allowed inside the window
     */
    public readonly maxAttempts: number,

    /**
     * The number of seconds until the window resets
     */
    public readonly decaySeconds: number
  ) {}

  /**
   * Record one attempt and report whether the key is now over its limit
   */
  async hit(): Promise<boolean> {
    return this.limiter.hit(this.key, this.maxAttempts, this.decaySeconds);
  }

  /**
   * Determine whether the key has used up its attempts
   */
  async tooManyAttempts(): Promise<boolean> {
    return this.limiter.tooManyAttempts(this.key, this.maxAttempts);
  }

  /**
   * The number of attempts recorded in the current window
   */
  async attempts(): Promise<number> {
    return this.limiter.attempts(this.key);
  }

  /**
   * The attempts left before the window closes
   */
  async remaining(): Promise<number> {
    return this.limiter.remaining(this.key, this.maxAttempts);
  }

  /**
   * Seconds until the key is accessible again
   */
  async retryAfter(): Promise<number> {
    return this.limiter.retryAfter(this.key);
  }

  /**
   * Seconds until the key is accessible again
   */
  async availableIn(): Promise<number> {
    return this.limiter.availableIn(this.key);
  }

  /**
   * Forget this key's counter and window timer
   */
  async clear(): Promise<void> {
    await this.limiter.clear(this.key);
  }
}

export class RateLimiter {
  /**
   * Default decay for keys that do not name one
   * Laravel: ThrottleRequests' $decayMinutes = 1 converted to seconds
   */
  static readonly DEFAULT_DECAY_SECONDS: number = 60;

  /**
   * The configured named limiters, keyed by limiter name
   * Laravel: RateLimiter::$limiters
   */
  protected limiters: Map<string, NamedLimiterCallback> = new Map();

  constructor(
    /**
     * The cache repository (or compatible store) holding hit counters and
     * window timers
     */
    protected readonly cache: RateLimiterCache
  ) {}

  // ==========================================================================
  // Named limiters
  // ==========================================================================

  /**
   * Register a named limiter; the `throttle:name` middleware reference looks
   * this callback up per request, so limits are defined by the application
   * instead of being hard-coded in the middleware (OCP)
   * Laravel: RateLimiter::for($name, $callback)
   */
  define(name: string, callback: NamedLimiterCallback): this {
    this.limiters.set(name, callback);
    return this;
  }

  /**
   * The callback behind a named limiter, or undefined when the name was
   * never defined
   * Laravel: RateLimiter::limiter()
   */
  limiter(name: string): NamedLimiterCallback | undefined {
    return this.limiters.get(name);
  }

  /**
   * Determine whether a named limiter is registered
   */
  has(name: string): boolean {
    return this.limiters.has(name);
  }

  /**
   * Remove a named limiter definition
   */
  forget(name: string): boolean {
    return this.limiters.delete(name);
  }

  /**
   * Resolve a named limiter against the request into its result: limit
   * definitions, the Unlimited marker, or a ready-made response
   */
  async resolve(name: string, request: Request): Promise<NamedLimiterResult> {
    const callback = this.limiter(name);

    if (!callback) {
      throw new Error(`The rate limiter [${name}] is not defined.`);
    }

    return await callback(request);
  }

  // ==========================================================================
  // Counting
  // ==========================================================================

  /**
   * A limiter handle bound to one key/window; every counting verb has a
   * direct equivalent here for code that keeps the handle around
   * Laravel: RateLimiter::for($key, $maxAttempts, $decaySeconds)
   */
  for(key: string, maxAttempts: number, decaySeconds: number = RateLimiter.DEFAULT_DECAY_SECONDS): Limited {
    return new Limited(this, key, maxAttempts, decaySeconds);
  }

  /**
   * Record an attempt against the key and report whether it is now over its
   * maximum - `true` means further requests are rate limited
   * Laravel: RateLimiter::hit() + tooManyAttempts()
   */
  async hit(
    key: string,
    maxAttempts: number,
    decaySeconds: number = RateLimiter.DEFAULT_DECAY_SECONDS
  ): Promise<boolean> {
    const now = RateLimiter.now();

    // The timer holds the window's close moment; add() keeps the original
    // expiry when a window is already open, so sliding hits never extend it
    await this.cache.add(this.timerKey(key), now + decaySeconds, decaySeconds);

    const added = await this.cache.add(this.hitsKey(key), 0, decaySeconds);
    const hits = Number(await this.cache.increment(this.hitsKey(key), 1)) || 1;

    // A counter the store resurrected without a TTL (increment on a missing
    // key) would live forever: re-arm the window in that race
    if (!added && hits === 1) {
      await this.cache.put(this.hitsKey(key), 1, decaySeconds);
    }

    return await this.tooManyAttempts(key, maxAttempts);
  }

  /**
   * Execute the callback unless the key has already used up its attempts;
   * the callback's result (or true when it returns nothing) is returned,
   * and false signals the caller was rate limited
   * Laravel: RateLimiter::attempt()
   */
  async attempt<T>(
    key: string,
    maxAttempts: number,
    callback: () => T | Promise<T>,
    decaySeconds: number = RateLimiter.DEFAULT_DECAY_SECONDS
  ): Promise<false | T | true> {
    if (await this.tooManyAttempts(key, maxAttempts)) {
      return false;
    }

    const result = await callback();
    await this.hit(key, maxAttempts, decaySeconds);

    return result === undefined ? true : result;
  }

  /**
   * Determine if the key has been accessed too many times; an expired window
   * resets the counter on the way through, exactly like Laravel
   * Laravel: RateLimiter::tooManyAttempts()
   */
  async tooManyAttempts(key: string, maxAttempts: number): Promise<boolean> {
    if ((await this.attempts(key)) >= maxAttempts) {
      if (await this.cache.has(this.timerKey(key))) {
        return true;
      }

      await this.clear(key);
    }

    return false;
  }

  /**
   * The number of attempts recorded for the key in its current window
   * Laravel: RateLimiter::attempts()
   */
  async attempts(key: string): Promise<number> {
    return Number((await this.cache.get(this.hitsKey(key), 0)) ?? 0);
  }

  /**
   * The attempts the key still has inside the current window
   * Laravel: RateLimiter::remaining()
   */
  async remaining(key: string, maxAttempts: number): Promise<number> {
    return Math.max(0, maxAttempts - (await this.attempts(key)));
  }

  /**
   * Forget the key's counter and window timer
   * Laravel: RateLimiter::clear()
   */
  async clear(key: string): Promise<void> {
    await this.cache.forget(this.hitsKey(key));
    await this.cache.forget(this.timerKey(key));
  }

  /**
   * The number of seconds until the key is accessible again; 0 when the
   * key has no open window
   * Laravel: RateLimiter::availableIn() / retryAfter()
   */
  async availableIn(key: string): Promise<number> {
    const expiresAt = Number((await this.cache.get(this.timerKey(key), 0)) ?? 0);

    return Math.max(0, Math.ceil(expiresAt - RateLimiter.now()));
  }

  /**
   * Seconds until the key is accessible again - the value carried in the
   * Retry-After header of a 429 response
   * Laravel: RateLimiter::retryAfter()
   */
  async retryAfter(key: string): Promise<number> {
    return this.availableIn(key);
  }

  /**
   * Counter and timer keys for a rate limit key, namespaced so they cannot
   * collide with application cache entries
   * Laravel: RateLimiter::cleanRateLimiterKey() + ':timer'
   */
  protected hitsKey(key: string): string {
    return `orchestr_rate_limiter:${key}`;
  }

  protected timerKey(key: string): string {
    return `orchestr_rate_limiter:${key}:timer`;
  }

  /**
   * Unix seconds, the unit every timer in this service stores
   */
  static now(): number {
    return Math.floor(Date.now() / 1000);
  }
}
