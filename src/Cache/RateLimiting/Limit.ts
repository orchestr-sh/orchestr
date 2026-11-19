/**
 * Limit - the rate limit definition a named limiter hands back
 * Illuminate\Cache\RateLimiting\Limit
 *
 * A Limit describes a window ("60 per minute", optionally keyed by ->by()),
 * it does not count anything itself: the throttle middleware feeds the
 * definition to the RateLimiter service, which owns all state (SRP). Apps
 * register definitions through RateLimiter::define so limits stay data the
 * application declares, never branches inside the middleware (OCP).
 *
 * @example
 * ```typescript
 * limiter.define('api', (request) =>
 *   Limit.perMinute(60).by(async (request) => String(await request.user()?.getAuthIdentifier() ?? request.ip()))
 * );
 * ```
 */

import type { Request } from '@/Routing/Request';
import type { ResponseObject } from '@/Routing/Responses';

/**
 * The limit key: a literal, or a callback resolving it from the request
 * Laravel: Limit::by($key = null)
 */
export type LimitKeyResolver = string | ((request: Request) => string | Promise<string>);

/**
 * The callback a rate-limited request receives; whatever it returns answers
 * the request in place of the 429
 * Laravel: Limit::response(fn ($request, $headers) => ...)
 */
export type LimitResponseCallback = (request: Request, headers: Record<string, string>) => ResponseObject;

export class Limit {
  /**
   * The key the window is counted under; when unset the throttle middleware
   * falls back to the request signature (user ID or IP + route)
   */
  key?: LimitKeyResolver;

  /**
   * Custom rate-limited response, replacing the 429 the middleware raises
   */
  responseCallback?: LimitResponseCallback;

  /**
   * The message the 429 carries instead of "Too Many Attempts."
   */
  message?: string;

  private constructor(
    /**
     * The maximum number of attempts allowed inside the window
     */
    public readonly maxAttempts: number,

    /**
     * The number of seconds until the window resets
     */
    public readonly decaySeconds: number
  ) {}

  // ==========================================================================
  // Window factories
  // ==========================================================================

  /**
   * n attempts per arbitrary number of seconds
   * Laravel: Limit::perSeconds($limit, $seconds = 1)
   */
  static perSeconds(maxAttempts: number, seconds: number = 1): Limit {
    return new Limit(maxAttempts, seconds);
  }

  /**
   * n attempts per second
   */
  static perSecond(maxAttempts: number): Limit {
    return new Limit(maxAttempts, 1);
  }

  /**
   * n attempts per five seconds
   */
  static perFiveSeconds(maxAttempts: number): Limit {
    return new Limit(maxAttempts, 5);
  }

  /**
   * n attempts per ten seconds
   */
  static perTenSeconds(maxAttempts: number): Limit {
    return new Limit(maxAttempts, 10);
  }

  /**
   * n attempts per thirty seconds
   */
  static perThirtySeconds(maxAttempts: number): Limit {
    return new Limit(maxAttempts, 30);
  }

  /**
   * n attempts per minute
   * Laravel: Limit::perMinute($limit = 60)
   */
  static perMinute(maxAttempts: number = 60): Limit {
    return new Limit(maxAttempts, 60);
  }

  /**
   * n attempts per hour
   */
  static perHour(maxAttempts: number = 3600): Limit {
    return new Limit(maxAttempts, 60 * 60);
  }

  /**
   * n attempts per day
   */
  static perDay(maxAttempts: number = 10_000): Limit {
    return new Limit(maxAttempts, 60 * 60 * 24);
  }

  // ==========================================================================
  // Fluent configuration
  // ==========================================================================

  /**
   * Key the window under a request-derived value - user ID, IP, API token,
   * anything the callback can read off the request
   * Laravel: Limit::by($key)
   */
  by(key: LimitKeyResolver): this {
    this.key = key;
    return this;
  }

  /**
   * Answer rate-limited requests with a custom response instead of the
   * middleware's 429
   * Laravel: Limit::response($callback)
   */
  response(callback: LimitResponseCallback): this {
    this.responseCallback = callback;
    return this;
  }

  /**
   * Replace the "Too Many Attempts." message on the 429
   * Laravel: Limit::messages($message)
   */
  messages(message: string): this {
    this.message = message;
    return this;
  }

  /**
   * Resolve this definition's key for the request; undefined when the limit
   * did not name one and the middleware should use the request signature
   */
  async resolveKey(request: Request): Promise<string | undefined> {
    if (this.key === undefined) {
      return undefined;
    }

    return typeof this.key === 'function' ? await this.key(request) : this.key;
  }
}
