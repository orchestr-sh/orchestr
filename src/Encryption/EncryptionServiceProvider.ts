/**
 * EncryptionServiceProvider
 *
 * Binds the Encrypter into the container under 'encrypter', reading the
 * application key from the `app.key` config value with the APP_KEY
 * environment variable as the fallback, exactly where Laravel's
 * config/app.php does. Register it after the ConfigServiceProvider so
 * configured values win:
 *
 * Laravel: Illuminate\Encryption\EncryptionServiceProvider
 *
 * @example
 * ```typescript
 * app.instance('config', new Config({ app: { key: 'base64:...' } }));
 * app.register(EncryptionServiceProvider);
 *
 * Crypt.decrypt(Crypt.encrypt({ a: 1 })); // { a: 1 }
 * ```
 */

import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import { Encrypter } from '@/Encryption/Encrypter';
import { ServiceProvider } from '@/Foundation/ServiceProvider';

export class EncryptionServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton('encrypter', () => new Encrypter(this.resolveKey()));
  }

  /**
   * The services provided by this provider
   */
  provides(): string[] {
    return ['encrypter'];
  }

  /**
   * Locate the application key: config first, then the APP_KEY environment
   * variable; an unusable key fails fast when the encrypter is built
   */
  protected resolveKey(): string | Buffer {
    const configured = this.configService()?.get<string>('app.key');

    if (typeof configured === 'string' && configured !== '') {
      return configured;
    }

    if (Buffer.isBuffer(configured)) {
      return configured;
    }

    const fromEnv = process.env.APP_KEY;

    if (fromEnv) {
      return fromEnv;
    }

    // The Encrypter turns the empty key into MissingAppKeyException with
    // Laravel's exact boot-time message
    return '';
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
