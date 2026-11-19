/**
 * Unlimited - the marker a named limiter returns to exempt the request from
 * rate limiting entirely (admin tokens, health checks, first-party callers)
 * Illuminate\Cache\RateLimiting\Unlimited
 *
 * @example
 * ```typescript
 * RateLimiter.define('api', (request) =>
 *   request.header('x-internal') ? new Unlimited() : Limit.perMinute(60)
 * );
 * ```
 */

export class Unlimited {
  constructor(
    /**
     * The resolved decision; truthy by default so a bare `new Unlimited()`
     * already exempts the request
     */
    public readonly value: unknown = true
  ) {}

  /**
   * Determine whether a named limiter result exempts the request
   */
  static resolves(result: unknown): result is Unlimited {
    return result instanceof Unlimited && Boolean(result.value);
  }
}
