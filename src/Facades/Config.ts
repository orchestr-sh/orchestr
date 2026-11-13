/**
 * Config Facade - Static access to configuration
 * Illuminate\Support\Facades\Config
 *
 * Like every other facade this is a runtime Proxy over the container's
 * 'config' binding (the Config repository): static-looking calls such as
 * Config.get('app.name') forward to the resolved instance. The bare
 * repository class is exported from the main entry as ConfigClass.
 *
 * @example
 * Config.get('app.name')
 * Config.set('app.debug', true)
 * Config.has('database.connections.mysql')
 */

import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import { Facade } from '@/Support/Facade';

class ConfigFacade extends Facade {
  protected static getFacadeAccessor(): string {
    return 'config';
  }
}

export const Config = new Proxy(ConfigFacade, {
  get(target, prop) {
    // First check if it's a static member on the facade class itself
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    // Then proxy to the config repository instance from the container
    try {
      const root = (target as any).getFacadeRoot() as ConfigClass;
      if (root && prop in root) {
        const value = (root as any)[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(root, args);
        }
        return value;
      }
    } catch {
      // Facade root not available yet
    }

    return undefined;
  },
}) as unknown as typeof ConfigFacade & ConfigClass;
