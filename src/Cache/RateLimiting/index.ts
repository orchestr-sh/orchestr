/**
 * Rate Limiting
 *
 * The definition objects named limiters hand back to the throttle middleware;
 * all counting state stays in the RateLimiter service (SRP). Mirrors
 * Laravel's Illuminate\Cache\RateLimiting namespace.
 */

export { Limit } from './Limit';
export type { LimitKeyResolver, LimitResponseCallback } from './Limit';
export { Unlimited } from './Unlimited';
