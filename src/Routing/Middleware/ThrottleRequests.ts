/**
 * ThrottleRequests middleware ('throttle' alias)
 *
 * Caps how often a key may hit a route inside a decay window, counting
 * through the shared RateLimiter service so HTTP routes, named limiters and
 * queue job middleware all observe the same buckets. Every throttled
 * response carries X-RateLimit-Limit / X-RateLimit-Remaining (plus
 * Retry-After with the window reset moment), and an exhausted key answers
 * with a 429 - JSON for API requests, HTML for browsers - rendered by the
 * shared exception handler with those same headers.
 *
 * Laravel: Illuminate\Routing\Middleware\ThrottleRequests
 *
 * Usage:
 * - `throttle:max,decay` - max attempts per decay *minutes*, matching the
 *   Laravel parameter: `throttle:60,1` is 60 requests per minute.
 * - `throttle:name` - the named limiter registered through
 *   `RateLimiter.define(name, callback)`; the callback receives the request
 *   and returns Limit(s), an Unlimited marker, or a ready-made response.
 *
 * Keys come from the authenticated user's ID when one is present and fall
 * back to the request IP (plus route), so throttling works for guests and
 * logged-in traffic alike.
 *
 * @example
 * ```typescript
 * kernel.middlewareAlias('throttle', ThrottleRequests);
 *
 * Route.post('/login', attemptLogin).middleware('throttle:10,1'); // 10 per minute
 *
 * RateLimiter.define('api', () => Limit.perMinute(60));
 * Route.group({ middleware: 'throttle:api' }, routes);
 * ```
 */

import { createHash } from 'crypto';
import type { RateLimiter } from '@/Cache/RateLimiter';
import type { Limit } from '@/Cache/RateLimiting/Limit';
import type { Middleware, NextFunction } from '@/Routing/Pipeline';
import type { Request } from '@/Routing/Request';
import type { Response } from '@/Routing/Response';
import { Unlimited } from '@/Cache/RateLimiting/Unlimited';
import { ThrottleRequestsException } from '@/Foundation/Exceptions';
import { ResponseObject } from '@/Routing/Responses';
import { getGlobalApp } from '@/Support/helpers';

/**
 * The window a bare `throttle` reference gets
 * Laravel: ThrottleRequests::handle() defaults of 60 attempts / 1 minute
 */
const DEFAULT_MAX_ATTEMPTS = 60;
const DEFAULT_DECAY_MINUTES = 1;

/**
 * A limit resolved for the running request: where to count, how much, and
 * what a rejection looks like
 */
interface ResolvedLimit {
  key: string;
  maxAttempts: number;
  decaySeconds: number;
  responseCallback?: (request: Request, headers: Record<string, string>) => ResponseObject;
  message?: string;
}

/**
 * Resolve the application's rate limiter from the container
 */
export function resolveRateLimiter(): RateLimiter {
  const app = getGlobalApp();

  if (!app) {
    throw new Error('Application not initialized. Call setGlobalApp() first.');
  }

  return app.make<RateLimiter>('limiter');
}

/**
 * Build a throttling middleware; the limiter factory is the seam for testing
 * and for apps that keep their own RateLimiter instance
 */
export function makeThrottleRequests(limiter?: () => RateLimiter): Middleware {
  const middleware: Middleware = async (req, res, next, ...args) => {
    const service = limiter ? limiter() : resolveRateLimiter();
    const [first, second] = args;

    // `throttle:name` - a single non-numeric argument that matches a
    // registered named limiter runs that limiter's callback instead of
    // reading numbers off the middleware reference (OCP: named limiters are
    // definitions the application registers, not branches in here)
    if (first !== undefined && !isNumeric(first) && service.has(first)) {
      const result = await service.resolve(first, req);

      // The callback answered with a response: hand it to the pipeline
      if (result instanceof ResponseObject) {
        return result;
      }

      // Unlimited: the request is exempt from throttling entirely
      if (Unlimited.resolves(result)) {
        await next();
        return undefined;
      }

      return enforce(service, await toLimits(result, first, req), req, res, next);
    }

    const maxAttempts = resolveMaxAttempts(first);
    const decaySeconds = resolveDecaySeconds(second);

    return enforce(
      service,
      [
        {
          key: await resolveRequestSignature(req),
          maxAttempts,
          decaySeconds,
        },
      ],
      req,
      res,
      next
    );
  };

  return middleware;
}

/**
 * The container-driven throttling middleware, ready for the 'throttle'
 * alias, a route group or the Kernel's global stack
 * Laravel: Kernel::$middlewareAliases['throttle']
 */
export const ThrottleRequests: Middleware = (req, res, next, ...args) =>
  makeThrottleRequests()(req, res, next, ...args);

/**
 * Turn a named limiter's Limit definitions into the keys/decays the
 * enforcement flow counts. A definition without ->by() falls back to the
 * request signature, so named limiters key by user ID or IP for free.
 */
async function toLimits(result: Limit | Limit[], name: string, req: Request): Promise<ResolvedLimit[]> {
  const definitions = Array.isArray(result) ? result : [result];
  const limits: ResolvedLimit[] = [];

  for (const limit of definitions) {
    const key = (await limit.resolveKey(req)) ?? (await resolveRequestSignature(req));

    limits.push({
      // Prefixing the limiter name keeps two named limiters sharing a key
      // from draining each other's windows, like Laravel's md5($name.$key)
      key: sha1(`${name}.${key}`),
      maxAttempts: limit.maxAttempts,
      decaySeconds: limit.decaySeconds,
      responseCallback: limit.responseCallback,
      message: limit.message,
    });
  }

  return limits;
}

/**
 * The shared flow for every limit set: reject exhausted keys before the
 * route runs, count the attempt, then decorate the response with the
 * X-RateLimit headers at write time
 */
async function enforce(
  service: RateLimiter,
  limits: ResolvedLimit[],
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void | ResponseObject> {
  for (const limit of limits) {
    if (await service.tooManyAttempts(limit.key, limit.maxAttempts)) {
      return reject(service, req, limit);
    }

    await service.hit(limit.key, limit.maxAttempts, limit.decaySeconds);
  }

  // The most-constrained limit - the one closest to breaching - describes
  // the window the caller sees
  const views = await Promise.all(
    limits.map(async (limit) => ({
      maxAttempts: limit.maxAttempts,
      remaining: await service.remaining(limit.key, limit.maxAttempts),
      retryAfter: await service.retryAfter(limit.key),
    }))
  );

  const tightest = views.reduce((worst, view) => (view.remaining < worst.remaining ? view : worst), views[0]);

  // Headers land at write time so short-circuiting route middleware and
  // exception-rendered answers pass through the limiter's accounting too
  res.beforeSend(() => {
    res.header('X-RateLimit-Limit', String(tightest.maxAttempts));
    res.header('X-RateLimit-Remaining', String(tightest.remaining));

    if (tightest.retryAfter > 0) {
      res.header('Retry-After', String(tightest.retryAfter));
      res.header('X-RateLimit-Reset', String(nowSeconds() + tightest.retryAfter));
    }
  });

  await next();

  return undefined;
}

/**
 * Build the rate-limited answer: the limit's custom Response when it
 * declared one (with the headers merged in), otherwise a
 * ThrottleRequestsException (429) whose headers the shared exception handler
 * carries onto the rendered response
 */
async function reject(service: RateLimiter, req: Request, limit: ResolvedLimit): Promise<ResponseObject> {
  const retryAfter = await service.retryAfter(limit.key);

  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(limit.maxAttempts),
    'X-RateLimit-Remaining': '0',
    'Retry-After': String(retryAfter),
    'X-RateLimit-Reset': String(nowSeconds() + retryAfter),
  };

  if (limit.responseCallback) {
    const response = limit.responseCallback(req, headers);

    // The default headers ride along unless the custom response set its own
    for (const [name, value] of Object.entries(headers)) {
      if (!(name in response.headers)) {
        response.headers[name] = value;
      }
    }

    return response;
  }

  throw new ThrottleRequestsException(limit.message ?? 'Too Many Attempts.', headers);
}

/**
 * Resolve the max-attempts parameter, falling back to the Laravel default
 * when the reference omitted it
 */
function resolveMaxAttempts(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_MAX_ATTEMPTS;
  }

  const parsed = Number.parseInt(raw, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`The rate limiter [${raw}] is not defined.`);
  }

  return parsed;
}

/**
 * The decay parameter is in minutes, matching `throttle:60,1` - 60 attempts
 * per minute in the Laravel middleware
 */
function resolveDecaySeconds(raw: string | undefined): number {
  const minutes = raw === undefined ? DEFAULT_DECAY_MINUTES : Number.parseFloat(raw);

  if (Number.isNaN(minutes) || minutes <= 0) {
    return DEFAULT_DECAY_MINUTES * 60;
  }

  return Math.ceil(minutes * 60);
}

/**
 * The bucket a request is counted against: the authenticated user's
 * identifier when one is bound to the request, otherwise the route and IP -
 * the same user-ID-or-IP keying Laravel's request signature produces
 * Laravel: ThrottleRequests::resolveRequestSignature()
 */
async function resolveRequestSignature(req: Request): Promise<string> {
  const user = await req.user();

  if (user) {
    return sha1(String(user.getAuthIdentifier()));
  }

  const route = req.route();
  const fingerprint = route ? `${route.name ?? route.uri}|${req.ip() ?? 'unknown'}` : `${req.method}:${req.getPath()}`;

  return sha1(fingerprint);
}

/**
 * Determine whether a middleware argument is a plain number
 */
function isNumeric(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value);
}

/**
 * Unix seconds, the unit limiter timers and X-RateLimit-Reset use
 */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Hash identifiers into safe cache keys, like Laravel's sha1 key shaping
 */
function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}
