import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { Application } from '@/Foundation/Application';
import { Config } from './Config';

/**
 * ConfigServiceProvider - Registers the configuration repository
 * Illuminate\Foundation\Providers\ConfigServiceProvider (partial)
 */
export class ConfigServiceProvider extends ServiceProvider {
  /**
   * Configuration items to register
   */
  private config: Record<string, any>;

  constructor(app: Application, config: Record<string, any> = {}) {
    super(app);
    this.config = config;
  }

  /**
   * Register the configuration repository
   */
  register(): void {
    this.app.singleton('config', () => {
      return new Config(this.config);
    });

    // Also bind the Config class itself
    this.app.singleton(Config, () => {
      return this.app.make('config');
    });
  }
}
