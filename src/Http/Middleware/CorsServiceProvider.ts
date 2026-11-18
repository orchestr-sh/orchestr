/**
 * CorsServiceProvider
 *
 * Ships the CORS middleware the way Laravel ships HandleCors in the
 * framework's global middleware stack: registering this provider puts
 * HandleCors at the front of the Kernel's stack (before session, CSRF and
 * routing middleware, so preflights never trip them) and merges the
 * `cors` configuration defaults into the config repository.
 *
 * Applications control behaviour entirely through `config('cors')`:
 * allowed origins, methods, headers, exposed headers, max age and the
 * credentials flag - no middleware subclassing (OCP).
 *
 * Laravel: Illuminate\Http\Middleware\HandleCors wiring in the app Kernel
 *
 * @example
 * ```typescript
 * app.instance('config', new Config({ cors: { allowed_origins: ['https://app.test'] } }));
 * app.register(CorsServiceProvider);
 *
 * const kernel = new Kernel(app);
 * app.instance('kernel', kernel);
 *
 * await app.boot(); // HandleCors is now in the global stack
 * ```
 */

import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import type { Kernel } from '@/Foundation/Http/Kernel';
import type { Middleware } from '@/Routing/Pipeline';
import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { resolveCorsConfig } from './CorsPolicy';
import { HandleCors } from './HandleCors';

export class CorsServiceProvider extends ServiceProvider {
  /**
   * Register the middleware reference the Kernel stack consumes
   */
  register(): void {
    this.app.bind('cors.middleware', () => HandleCors);
  }

  /**
   * The services provided by this provider
   */
  provides(): string[] {
    return ['cors.middleware'];
  }

  /**
   * Fill in the `cors` configuration defaults and place the HandleCors
   * middleware at the start of the Kernel's global stack
   */
  boot(): void {
    this.mergeConfigDefaults();

    const middleware = this.app.bound('cors.middleware') ? this.app.make<Middleware>('cors.middleware') : HandleCors;

    if (!this.app.bound('kernel')) {
      return;
    }

    let kernel: Kernel;

    try {
      kernel = this.app.make<Kernel>('kernel');
    } catch {
      return;
    }

    // Registering the provider twice - or adding the middleware by hand -
    // must not send the same response through CORS twice
    if (kernel.getMiddleware().includes(middleware)) {
      return;
    }

    kernel.prepend(middleware);
  }

  /**
   * Layer the shipped defaults under whatever the application configured,
   * mirroring config/cors.php: framework keys answer unless the app
   * overrides them
   */
  protected mergeConfigDefaults(): void {
    const configService = this.configService();

    if (!configService) {
      return;
    }

    const configured = configService.get<unknown>('cors');
    const resolved = resolveCorsConfig(configured);

    configService.set('cors', resolved);
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
