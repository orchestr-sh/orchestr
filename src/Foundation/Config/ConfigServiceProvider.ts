import { Application } from '@/Foundation/Application';
import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { Config } from './Config';
import { ConfigLoader } from './ConfigLoader';

/**
 * ConfigServiceProvider - Registers the configuration repository
 * Illuminate\Foundation\Providers\ConfigServiceProvider (partial)
 *
 * Accepts an inline configuration object (kept for programmatic setups) and,
 * during boot, merges in the `config/` directory files (or their cached
 * snapshot) so `config/database.ts` is reachable as `config('database')`.
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

  /**
   * Merge the configuration sources (cached snapshot or config files) into
   * the repository. File values intentionally layer over inline values so
   * on-disk configuration stays authoritative, mirroring Laravel.
   */
  async boot(): Promise<void> {
    const loader = new ConfigLoader(this.app);
    const loaded = await loader.load();

    if (Object.keys(loaded).length === 0) {
      return;
    }

    this.app.make<Config>('config').merge(loaded);
  }
}
