/**
 * TrustProxiesServiceProvider
 *
 * Ships the proxy-trust middleware the way Laravel ships TrustProxies at
 * the front of the framework's global middleware stack: registering this
 * provider puts TrustProxies before every other middleware (so anything
 * that asks the request where it came from - rate limiting, logging,
 * session - sees the resolved values) and merges the `trustedproxy`
 * configuration defaults into the config repository.
 *
 * Applications control behaviour entirely through `config('trustedproxy')`:
 * which proxies to trust (`*`, exact addresses, CIDR blocks) and which
 * forwarded headers to honour - no middleware subclassing (OCP).
 *
 * Laravel: Illuminate\Http\Middleware\TrustProxies wiring in the app Kernel
 *
 * @example
 * ```typescript
 * app.instance('config', new Config({ trustedproxy: { proxies: ['203.0.113.10'] } }));
 * app.register(TrustProxiesServiceProvider);
 *
 * const kernel = new Kernel(app);
 * app.instance('kernel', kernel);
 *
 * await app.boot(); // TrustProxies is now at the front of the global stack
 * ```
 */

import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import type { Kernel } from '@/Foundation/Http/Kernel';
import type { Middleware } from '@/Routing/Pipeline';
import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { resolveTrustedProxyConfig } from './TrustedProxyResolver';
import { TrustProxies } from './TrustProxies';

export class TrustProxiesServiceProvider extends ServiceProvider {
  /**
   * Register the middleware reference the Kernel stack consumes
   */
  register(): void {
    this.app.bind('trustedproxy.middleware', () => TrustProxies);
  }

  /**
   * The services provided by this provider
   */
  provides(): string[] {
    return ['trustedproxy.middleware'];
  }

  /**
   * Fill in the `trustedproxy` configuration defaults and place the
   * TrustProxies middleware at the front of the Kernel's global stack
   */
  boot(): void {
    this.mergeConfigDefaults();

    const middleware = this.app.bound('trustedproxy.middleware')
      ? this.app.make<Middleware>('trustedproxy.middleware')
      : TrustProxies;

    if (!this.app.bound('kernel')) {
      return;
    }

    let kernel: Kernel;

    try {
      kernel = this.app.make<Kernel>('kernel');
    } catch {
      return;
    }

    // Registering the provider twice must not install the trust boundary
    // twice (harmless per request, but the stack should stay honest)
    if (kernel.getMiddleware().includes(middleware)) {
      return;
    }

    kernel.prepend(middleware);
  }

  /**
   * Layer the shipped defaults under whatever the application configured,
   * mirroring config/trustedproxy.ts: framework keys answer unless the app
   * overrides them
   */
  protected mergeConfigDefaults(): void {
    const configService = this.configService();

    if (!configService) {
      return;
    }

    const configured = configService.get<unknown>('trustedproxy');
    const resolved = resolveTrustedProxyConfig(configured);

    configService.set('trustedproxy', resolved);
  }

  /**
   * Resolve the config repository when the ConfigServiceProvider registered
   * one
   */
  protected configService(): ConfigClass | null {
    try {
      return this.app.bound('config') ? this.app.make<ConfigClass>('config') : null;
    } catch {
      return null;
    }
  }
}
