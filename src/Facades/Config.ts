import { Facade } from '@/Support/Facade';
import type { Config as ConfigClass } from '@/Foundation/Config/Config';

/**
 * Config Facade - Static access to configuration
 * Illuminate\Support\Facades\Config
 *
 * @example
 * Config.get('app.name')
 * Config.set('app.debug', true)
 * Config.has('database.connections.mysql')
 */
class ConfigFacade extends Facade {
  protected static getFacadeAccessor(): string {
    return 'config';
  }
}

// Export facade with proper typing
export const Config = ConfigFacade as typeof ConfigFacade & ConfigClass;
