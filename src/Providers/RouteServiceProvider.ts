import { ServiceProvider } from '../Foundation/ServiceProvider';
import { Router } from '../Routing/Router';
import { Facade } from '../Support/Facade';

/**
 * RouteServiceProvider - Registers the router in the container
 */
export class RouteServiceProvider extends ServiceProvider {
  register(): void {
    // Set up facade application first
    Facade.setFacadeApplication(this.app);

    // Then register the router
    this.app.singleton('router', () => new Router(this.app));
  }

  boot(): void {
    // Boot logic
  }
}
