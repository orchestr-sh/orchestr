/**
 * SessionServiceProvider
 *
 * Binds the SessionManager into the container under 'session', assembling
 * its configuration from the `session.*` config keys with Laravel-style
 * defaults. Register it after the ConfigServiceProvider so configured
 * values win:
 *
 * Laravel: Illuminate\Session\SessionServiceProvider
 *
 * @example
 * ```typescript
 * app.register(SessionServiceProvider);
 * kernel.use(StartSession, VerifyCsrfToken);
 * ```
 */

import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import type { SessionConfig } from '@/Session/SessionManager';
import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { SessionManager } from '@/Session/SessionManager';

export class SessionServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton('session', () => new SessionManager(this.getConfig()));

    // Laravel binds the active session store as 'session.store'; the
    // manager tracks it per request, so resolve through to it
    this.app.bind('session.store', () => this.app.make<SessionManager>('session').current());
  }

  /**
   * The services provided by this provider
   */
  provides(): string[] {
    return ['session', 'session.store'];
  }

  /**
   * Read the `session` config section, filling in production cookie
   * defaults the app left unset
   */
  protected getConfig(): Partial<SessionConfig> {
    const configured = this.readConfig();

    const partial: Partial<SessionConfig> = { ...configured };

    // Secure by default over HTTPS in production, like config/session.php
    if (partial.secure === undefined) {
      partial.secure = this.app.environment() === 'production';
    }

    // Cookie-session payloads sign with the app key unless told otherwise
    if (partial.key === undefined) {
      const appKey = this.configService()?.get<string>('app.key');

      if (appKey) {
        partial.key = appKey;
      }
    }

    return partial;
  }

  /**
   * Pull the raw session configuration out of the config repository
   */
  protected readConfig(): Partial<SessionConfig> {
    const configService = this.configService();

    if (!configService) {
      return {};
    }

    const section = configService.get('session');

    return section && typeof section === 'object' ? (section as Partial<SessionConfig>) : {};
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
