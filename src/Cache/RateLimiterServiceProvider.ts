/**
 * RateLimiterServiceProvider
 *
 * Binds the cache-backed RateLimiter under 'limiter' - the service the
 * throttle middleware, the queue's RateLimited job middleware and the
 * RateLimiter facade all share. Like Laravel's RateLimiterServiceProvider
 * the limiter stores its counters in a dedicated cache store when the
 * application configures `cache.rate_limiter`, falling back to the default
 * store.
 *
 * On boot it ships the Laravel Kernel's 'throttle' middleware alias
 * (Illuminate\Routing\Middleware\ThrottleRequests) when the application has
 * not claimed the name already.
 *
 * Laravel: Illuminate\Cache\RateLimiterServiceProvider
 *
 * @example
 * ```typescript
 * app.register(RateLimiterServiceProvider);
 * await app.boot(); // installs the 'throttle' alias
 *
 * Route.post('/login', attemptLogin).middleware('throttle:10,1');
 * ```
 */

import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import type { Middleware } from '@/Routing/Pipeline';
import type { Router } from '@/Routing/Router';
import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { ThrottleRequests } from '@/Routing/Middleware/ThrottleRequests';
import type { CacheManager } from './CacheManager';
import { RateLimiter } from './RateLimiter';

export class RateLimiterServiceProvider extends ServiceProvider {
  /**
   * Bind the rate limiter over the application's cache
   */
  register(): void {
    this.app.singleton(
      'limiter',
      () => new RateLimiter(this.app.make<CacheManager>('cache').store(this.rateLimiterStore()))
    );
  }

  /**
   * The services provided by this provider
   */
  provides(): string[] {
    return ['limiter'];
  }

  /**
   * Ship the 'throttle' middleware alias, like the Laravel Kernel's
   * $middlewareAliases. Apps can re-register the name with
   * Router::aliasMiddleware() before or after boot to take control.
   */
  boot(): void {
    if (!this.app.bound('router')) {
      return;
    }

    let router: Router;

    try {
      router = this.app.make<Router>('router');
    } catch {
      return;
    }

    const aliases: Record<string, Middleware> = router.getMiddleware();

    if (!aliases.throttle) {
      router.aliasMiddleware('throttle', ThrottleRequests);
    }
  }

  /**
   * The cache store name the limiter keeps its counters in, from
   * `cache.rate_limiter` (Laravel's own key), or undefined for the default
   */
  protected rateLimiterStore(): string | undefined {
    const configService = this.configService();

    return configService?.get<string>('cache.rate_limiter') ?? undefined;
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
