/**
 * HandleCors middleware
 *
 * Answers cross-origin requests from the `cors` configuration: preflights
 * (OPTIONS + Origin + Access-Control-Request-Method) get a 204 carrying the
 * granted origins, methods, headers and cache lifetime; actual requests get
 * their Access-Control-Allow-Origin (+ credentials / expose-headers)
 * attached. Requests whose origin is not allowed - and non-CORS requests -
 * simply continue down the pipeline with no CORS headers.
 *
 * All header calculation lives in the CorsPolicy (SRP); this middleware
 * only wires the request into the policy and the policy's answer into the
 * response.
 *
 * Laravel: Illuminate\Http\Middleware\HandleCors (global stack)
 *
 * @example
 * ```typescript
 * // config/cors.ts
 * export default {
 *   allowed_origins: ['https://app.test'],
 *   allowed_methods: ['POST', 'GET'],
 *   supports_credentials: true,
 *   max_age: 3600,
 * };
 *
 * kernel.prepend(HandleCors); // CorsServiceProvider does this for you
 * ```
 */

import type { Middleware } from '@/Routing/Pipeline';
import { ResponseObject } from '@/Routing/Responses';
import { getGlobalApp } from '@/Support/helpers';
import type { CorsConfig, CorsPolicy as CorsPolicyType } from './CorsPolicy';
import { CorsPolicy as CorsPolicyClass, resolveCorsConfig } from './CorsPolicy';

/**
 * Read the application's `cors` configuration section
 * Laravel: config('cors')
 */
export function resolveCorsOptions(): Partial<CorsConfig> {
  const app = getGlobalApp();

  if (!app || !app.bound('config')) {
    return {};
  }

  try {
    const config = app.make<{ get: <T = any>(key: string, defaultValue?: T) => T }>('config');
    const section = config.get<unknown>('cors');

    return section && typeof section === 'object' ? (section as Partial<CorsConfig>) : {};
  } catch {
    return {};
  }
}

/**
 * Build a CORS middleware over an explicit policy - the seam for testing
 * and for apps that construct their own CorsPolicy
 */
export function makeHandleCors(policy?: () => CorsPolicyType): Middleware {
  const policyOf = () => (policy ? policy() : new CorsPolicyClass(resolveCorsConfig(resolveCorsOptions())));

  const middleware: Middleware = async (req, res, next) => {
    const cors = policyOf();

    if (!cors.isCorsRequest(req)) {
      return next();
    }

    if (cors.isPreflightRequest(req)) {
      // A preflight from a disallowed origin carries no CORS headers and
      // keeps running down the pipeline, answering however the routes see
      // an unknown OPTIONS request
      if (!cors.isOriginAllowed(req.header('origin') ?? '')) {
        return next();
      }

      // 204 No Content is the status browsers expect for an accepted
      // preflight
      return new ResponseObject(null, 204, cors.preflightHeaders(req));
    }

    // Actual request: continue, then decorate the response the pipeline
    // produced (or the exception handler renders) with the CORS answers
    const headers = cors.actualRequestHeaders(req);

    if (Object.keys(headers).length > 0) {
      res.beforeSend(() => {
        for (const [name, value] of Object.entries(headers)) {
          res.header(name, value);
        }
      });
    }

    return next();
  };

  return middleware;
}

/**
 * The container-driven CORS middleware, ready for the Kernel's global stack
 * Laravel: Kernel::$middleware's HandleCors entry
 */
export const HandleCors: Middleware = (req, res, next) => makeHandleCors()(req, res, next);
