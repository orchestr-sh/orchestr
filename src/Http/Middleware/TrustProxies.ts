/**
 * TrustProxies middleware
 *
 * Installs the proxy-trust boundary on every request before anything else
 * looks at where it came from: the resolver built from the `trustedproxy`
 * configuration decides which sources are trusted proxies and which
 * forwarded headers may be honoured. Request.ip(), Request.ips(),
 * isSecure(), scheme(), host() and port() then answer from `X-Forwarded-*`
 * for trusted sources - and from the socket alone for everyone else, so
 * forwarded headers a client forged are ignored.
 *
 * All trust rules live in the TrustedProxyResolver (SRP); this middleware
 * only reads the configuration and wires the resolver onto the request.
 *
 * Laravel: App\Http\Middleware\TrustProxies / SetTrustedProxies, in front of
 * the rest of the global middleware stack
 *
 * @example
 * ```typescript
 * // config/trustedproxy.ts
 * export default {
 *   proxies: ['203.0.113.10', '10.0.0.0/8'],
 *   headers: ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-port'],
 * };
 *
 * kernel.prepend(TrustProxies); // TrustProxiesServiceProvider does this for you
 * ```
 */

import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import type { Middleware } from '@/Routing/Pipeline';
import { getGlobalApp } from '@/Support/helpers';
import type { TrustedProxyConfig } from './TrustedProxyResolver';
import { resolveTrustedProxyConfig, TrustedProxyResolver } from './TrustedProxyResolver';

/**
 * Read the application's `trustedproxy` configuration section
 * Laravel: config('trustedproxy')
 */
export function resolveTrustedProxyOptions(): Partial<TrustedProxyConfig> {
  const app = getGlobalApp();

  if (!app || !app.bound('config')) {
    return {};
  }

  try {
    const config = app.make<ConfigClass>('config');
    const section = config.get<unknown>('trustedproxy');

    return section && typeof section === 'object' ? (section as Partial<TrustedProxyConfig>) : {};
  } catch {
    return {};
  }
}

/**
 * Build a TrustProxies middleware over an explicit resolver - the seam for
 * testing and for apps that construct their own TrustedProxyResolver
 */
export function makeTrustProxies(resolver?: () => TrustedProxyResolver): Middleware {
  const resolverOf = () =>
    resolver ? resolver() : new TrustedProxyResolver(resolveTrustedProxyConfig(resolveTrustedProxyOptions()));

  const middleware: Middleware = (req, _res, next) => {
    req.setTrustedProxies(resolverOf());

    return next();
  };

  return middleware;
}

/**
 * The container-driven proxy-trust middleware, ready for the Kernel's
 * global stack
 * Laravel: the Kernel::$middleware TrustProxies entry
 */
export const TrustProxies: Middleware = (req, res, next) => makeTrustProxies()(req, res, next);
