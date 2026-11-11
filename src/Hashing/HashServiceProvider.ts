/**
 * HashServiceProvider
 *
 * Binds the HashManager into the container under 'hash', assembling its
 * configuration from the `hashing.*` config keys with Laravel-style
 * defaults. Register it after the ConfigServiceProvider so configured
 * values win:
 *
 * Laravel: Illuminate\Hashing\HashServiceProvider
 *
 * @example
 * ```typescript
 * app.instance('config', new Config({ hashing: { driver: 'bcrypt' } }));
 * app.register(HashServiceProvider);
 *
 * Hash.make('secret');
 * ```
 */

import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import type { HashingConfig } from '@/Hashing/HashManager';
import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { HashManager } from '@/Hashing/HashManager';

export class HashServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton('hash', () => new HashManager(this.getConfig()));
  }

  /**
   * The services provided by this provider
   */
  provides(): string[] {
    return ['hash'];
  }

  /**
   * Pull the raw `hashing` configuration out of the config repository
   */
  protected getConfig(): Partial<HashingConfig> {
    const configService = this.configService();

    if (!configService) {
      return {};
    }

    const section = configService.get('hashing');

    return section && typeof section === 'object' ? (section as Partial<HashingConfig>) : {};
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
