/**
 * HTTP Middleware
 *
 * Reusable HTTP middleware owned by the transport layer, mirroring
 * Laravel's Illuminate\Http\Middleware namespace: the CORS stack (policy,
 * middleware, provider) that answers cross-origin requests, and the
 * trusted-proxy stack (resolver, middleware, provider) that decides which
 * load balancer headers may be honoured.
 */

export { CorsPolicy, DEFAULT_CORS_CONFIG, resolveCorsConfig } from './CorsPolicy';
export type { CorsConfig } from './CorsPolicy';
export { HandleCors, makeHandleCors, resolveCorsOptions } from './HandleCors';
export { CorsServiceProvider } from './CorsServiceProvider';
export { TrustedProxyResolver, DEFAULT_TRUSTED_PROXY_CONFIG, resolveTrustedProxyConfig } from './TrustedProxyResolver';
export type { TrustedProxyConfig } from './TrustedProxyResolver';
export { TrustProxies, makeTrustProxies, resolveTrustedProxyOptions } from './TrustProxies';
export { TrustProxiesServiceProvider } from './TrustProxiesServiceProvider';
