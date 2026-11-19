/**
 * PasswordResetServiceProvider
 *
 * Binds the PasswordBrokerManager into the container under
 * `auth.password` - the service the Password facade and the password()
 * helper reach. The manager reads its `auth.passwords` /
 * `auth.defaults.passwords` configuration off the AuthManager (which
 * already merges the defaults, DRY) and resolves the auth manager, the
 * application key and the database connection lazily, so registration
 * order never matters (the AuthServiceProvider seam again).
 *
 * Register it after ConfigServiceProvider and AuthServiceProvider; the
 * DatabaseServiceProvider supplies the token table's connection at
 * resolution time, whenever it is registered.
 *
 * Laravel: Illuminate\Auth\Passwords\PasswordResetServiceProvider
 */

import type { AuthManager } from '@/Auth/AuthManager';
import type { DatabaseManager } from '@/Database/DatabaseManager';
import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import { PasswordBrokerManager } from '@/Auth/Passwords/PasswordBrokerManager';
import { ServiceProvider } from '@/Foundation/ServiceProvider';

export class PasswordResetServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(
      'auth.password',
      () =>
        new PasswordBrokerManager({
          // Resolved at broker-build time, so the AuthManager only needs
          // to exist before the first password() call
          auth: () => this.app.make<AuthManager>('auth'),
          appKey: () => this.configValue('app.key'),
          database: () => {
            if (!this.app.bound('db')) {
              return null;
            }

            try {
              return this.app.make<DatabaseManager>('db');
            } catch {
              return null;
            }
          },
        })
    );
  }

  /**
   * The services provided by this provider
   */
  provides(): string[] {
    return ['auth.password'];
  }

  /**
   * Read one config value, tolerating a missing repository
   */
  protected configValue<T = string>(key: string): T | undefined {
    try {
      return this.app.bound('config') ? this.app.make<ConfigClass>('config').get<T>(key) : undefined;
    } catch {
      return undefined;
    }
  }
}
