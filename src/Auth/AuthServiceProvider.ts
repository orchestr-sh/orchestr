/**
 * AuthServiceProvider
 *
 * Binds the AuthManager into the container under 'auth' (plus the
 * 'auth.driver' default-guard alias), assembling its configuration from the
 * `auth.*` config keys and wiring the session manager and hashing manager
 * into it lazily. Register it after ConfigServiceProvider (configured values
 * win), SessionServiceProvider and HashServiceProvider.
 *
 * On boot it also ships the Laravel Kernel's 'auth' and 'guest' middleware
 * aliases (Illuminate\Auth\Middleware\Authenticate / RedirectIfAuthenticated)
 * when the application has not claimed them already.
 *
 * Laravel: Illuminate\Auth\AuthServiceProvider
 *
 * @example
 * ```typescript
 * app.instance('config', new Config({ auth: { providers: { users: { driver: 'ensemble', model: User } } } }));
 * app.register(AuthServiceProvider);
 * await app.boot(); // installs the 'auth'/'guest' aliases
 *
 * router.get('/dashboard', show).middleware('auth');
 * router.get('/login', form).middleware('guest');
 * ```
 */

import type { AuthConfig } from '@/Auth/AuthManager';
import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import type { Hasher } from '@/Hashing/Contracts/Hasher';
import type { Middleware } from '@/Routing/Pipeline';
import type { Router } from '@/Routing/Router';
import type { SessionManager } from '@/Session/SessionManager';
import { AuthManager } from '@/Auth/AuthManager';
import { Authenticate } from '@/Auth/Middleware/Authenticate';
import { RedirectIfAuthenticated } from '@/Auth/Middleware/RedirectIfAuthenticated';
import { ServiceProvider } from '@/Foundation/ServiceProvider';

export class AuthServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(
      'auth',
      () =>
        new AuthManager(this.getConfig(), {
          // The guard scope re-binds per request; resolve whatever session
          // StartSession attached to the running one
          session: () => {
            if (!this.app.bound('session')) {
              return null;
            }

            try {
              return this.app.make<SessionManager>('session').current();
            } catch {
              return null;
            }
          },
          // Use the app's hasher when HashServiceProvider registered one;
          // checked at call time so registration order does not matter, and
          // returning undefined lets the manager fall back to its defaults
          hash: () => {
            if (!this.app.bound('hash')) {
              return undefined as unknown as Hasher;
            }

            try {
              return this.app.make<Hasher>('hash');
            } catch {
              return undefined as unknown as Hasher;
            }
          },
        })
    );

    // Laravel binds 'auth.driver' to the default guard; resolve through so
    // it always reflects the current guard scope
    this.app.bind('auth.driver', () => this.app.make<AuthManager>('auth').guard());
  }

  /**
   * The services provided by this provider
   */
  provides(): string[] {
    return ['auth', 'auth.driver'];
  }

  /**
   * Ship the 'auth' and 'guest' middleware aliases, like the Laravel app
   * Kernel's $middlewareAliases. Apps can re-register either name with
   * Router::aliasMiddleware() before or after boot to take control.
   */
  boot(): void {
    if (!this.app.bound('router')) {
      return;
    }

    let router: Router;

    try {
      router = this.app.make<Router>('router');
    } catch {
      return;
    }

    const aliases: Record<string, Middleware> = router.getMiddleware();

    if (!aliases.auth) {
      router.aliasMiddleware('auth', Authenticate);
    }

    if (!aliases.guest) {
      router.aliasMiddleware('guest', RedirectIfAuthenticated);
    }
  }

  /**
   * Pull the raw `auth` configuration out of the config repository
   */
  protected getConfig(): Partial<AuthConfig> {
    const configService = this.configService();

    if (!configService) {
      return {};
    }

    const section = configService.get('auth');

    return section && typeof section === 'object' ? (section as Partial<AuthConfig>) : {};
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
