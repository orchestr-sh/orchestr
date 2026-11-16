import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { RouteCache } from '@/Routing/RouteCache';
import { Router } from '@/Routing/Router';
import { Facade } from '@/Support/Facade';

/**
 * RouteServiceProvider - Registers the router in the container
 * Similar to Laravel's RouteServiceProvider
 */
export class RouteServiceProvider extends ServiceProvider {
  /**
   * The path to the route files
   * Override this in your app's RouteServiceProvider
   */
  protected routesPath?: string;

  /**
   * Route file loaders
   * Override this method to customize how routes are loaded
   */
  protected routeLoaders: (() => void | Promise<void>)[] = [];

  register(): void {
    // Set up facade application first
    Facade.setFacadeApplication(this.app);

    // Then register the router
    this.app.singleton('router', () => new Router(this.app));
  }

  async boot(): Promise<void> {
    // A cached route collection replaces the route files, exactly like
    // Laravel's RouteServiceProvider deferring to routesAreCached(): the
    // snapshot is hydrated straight into the router and the loaders never
    // import. `route:clear` restores file loading.
    if (this.app.routesAreCached()) {
      const router = this.app.make<Router>('router');
      new RouteCache(this.app).restore(router);
      return;
    }

    // Load routes from route loaders
    for (const loader of this.routeLoaders) {
      await loader();
    }
  }

  /**
   * Load routes from a file or callback
   * Laravel: $this->routes(function() { require base_path('routes/web.php'); })
   */
  protected routes(callback: () => void | Promise<void>): this {
    this.routeLoaders.push(callback);
    return this;
  }

  /**
   * Load routes from a module
   * Usage: loadRoutesFrom(() => import('@/routes/web'))
   */
  protected async loadRoutesFrom(importer: () => Promise<any>): Promise<void> {
    await importer();
  }
}
