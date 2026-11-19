/**
 * RateLimiter Facade
 *
 * Static access to the cache-backed rate limiter bound under 'limiter'.
 * Applications register named limiters from their route service provider
 * and use the counting verbs directly in controllers, jobs and listeners.
 *
 * @example
 * ```typescript
 * import { RateLimiter, Limit } from '@orchestr-sh/orchestr';
 *
 * // Named limiters, consulted by ->middleware('throttle:api')
 * RateLimiter.define('api', (request) => Limit.perMinute(60).by(async (request) =>
 *   String((await request.user())?.getAuthIdentifier() ?? request.ip())
 * ));
 *
 * // Direct use
 * if (await RateLimiter.tooManyAttempts('send-message:' + user.id, 5)) {
 *   return `Try again in ${await RateLimiter.availableIn('send-message:' + user.id)} seconds`;
 * }
 *
 * await RateLimiter.hit('send-message:' + user.id, 5);
 * ```
 */

import type {
  Limited,
  NamedLimiterCallback,
  NamedLimiterResult,
  RateLimiter as RateLimiterService,
} from '@/Cache/RateLimiter';
import type { Request } from '@/Routing/Request';
import { Facade } from '@/Support/Facade';

class RateLimiterFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'limiter';
  }

  /**
   * The limiter instance behind the facade
   */
  private static root(): RateLimiterService {
    return this.getFacadeRoot() as RateLimiterService;
  }

  /**
   * Register a named limiter definition
   * Laravel: RateLimiter::for($name, $callback) (spelled define() here to
   * keep for() as the counting-handle factory)
   */
  static define(name: string, callback: NamedLimiterCallback): void {
    this.root().define(name, callback);
  }

  /**
   * Determine whether a named limiter is registered
   */
  static has(name: string): boolean {
    return this.root().has(name);
  }

  /**
   * Remove a named limiter definition
   */
  static forget(name: string): boolean {
    return this.root().forget(name);
  }

  /**
   * Resolve a named limiter against the request
   */
  static async resolve(name: string, request: Request): Promise<NamedLimiterResult> {
    return await this.root().resolve(name, request);
  }

  /**
   * A counting handle bound to one key and window
   * Laravel: RateLimiter::for($key, $maxAttempts, $decaySeconds)
   */
  static for(key: string, maxAttempts: number, decaySeconds?: number): Limited {
    return this.root().for(key, maxAttempts, decaySeconds);
  }

  /**
   * Record an attempt; true when the key is now over its limit
   */
  static async hit(key: string, maxAttempts: number, decaySeconds?: number): Promise<boolean> {
    return await this.root().hit(key, maxAttempts, decaySeconds);
  }

  /**
   * Run the callback unless the key has exhausted its attempts
   */
  static async attempt<T>(
    key: string,
    maxAttempts: number,
    callback: () => T | Promise<T>,
    decaySeconds?: number
  ): Promise<false | T | true> {
    return await this.root().attempt(key, maxAttempts, callback, decaySeconds);
  }

  /**
   * The attempts recorded for a key in its current window
   */
  static async attempts(key: string): Promise<number> {
    return await this.root().attempts(key);
  }

  /**
   * Determine whether the key has been accessed too many times
   */
  static async tooManyAttempts(key: string, maxAttempts: number): Promise<boolean> {
    return await this.root().tooManyAttempts(key, maxAttempts);
  }

  /**
   * The attempts left for a key inside its window
   */
  static async remaining(key: string, maxAttempts: number): Promise<number> {
    return await this.root().remaining(key, maxAttempts);
  }

  /**
   * Forget the key's counter and window timer
   */
  static async clear(key: string): Promise<void> {
    await this.root().clear(key);
  }

  /**
   * Seconds until the key is accessible again (Retry-After)
   */
  static async retryAfter(key: string): Promise<number> {
    return await this.root().retryAfter(key);
  }

  /**
   * Seconds until the key is accessible again
   */
  static async availableIn(key: string): Promise<number> {
    return await this.root().availableIn(key);
  }
}

export const RateLimiter = RateLimiterFacadeClass;
