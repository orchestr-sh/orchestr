import { ServiceProvider } from '@/Foundation/ServiceProvider';
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
