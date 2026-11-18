/**
 * HTTP Middleware
 *
 * Reusable HTTP middleware owned by the transport layer, mirroring
 * Laravel's Illuminate\Http\Middleware namespace: the CORS stack (policy,
 * middleware, provider) that answers cross-origin requests.
 */

export { CorsPolicy, DEFAULT_CORS_CONFIG, resolveCorsConfig } from './CorsPolicy';
export type { CorsConfig } from './CorsPolicy';
export { HandleCors, makeHandleCors, resolveCorsOptions } from './HandleCors';
export { CorsServiceProvider } from './CorsServiceProvider';
