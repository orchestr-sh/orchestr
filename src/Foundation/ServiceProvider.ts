import { Application } from './Application';

/**
 * ServiceProvider - Laravel's Service Provider base class
 * Used to register and bootstrap application services
 */
export abstract class ServiceProvider {
  protected app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  /**
   * Register any application services
   * This is where you bind things into the container
   */
  abstract register(): void;

  /**
   * Bootstrap any application services
   * This runs after all providers have been registered
   */
  boot?(): void;

  /**
   * Get the services provided by the provider
   */
  provides?(): string[];
}
