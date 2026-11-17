/**
 * MailServiceProvider
 *
 * Binds the MailManager into the container under `mailer` - the key the
 * `Mail.fake()` installer swaps out for a recorder - assembling it from
 * the `mail` config section with Laravel-style defaults. The transports
 * themselves are the manager's business (they ship with it, like the
 * filesystem drivers), so this provider stays a thin configuration
 * shell.
 *
 * Mirrors Laravel's Illuminate\Mail\MailServiceProvider.
 *
 * @example
 * ```typescript
 * app.instance('config', new Config({ mail: { default: 'array' } }));
 * app.register(MailServiceProvider);
 *
 * await mail().send(new WelcomeMail(user));
 * ```
 */

import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import type { MailConfig } from '@/Mail/MailManager';
import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { MailManager } from '@/Mail/MailManager';

export class MailServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton('mailer', () => new MailManager(this.getConfig(), this.app));
  }

  /**
   * The services provided by this provider
   */
  provides(): string[] {
    return ['mailer'];
  }

  /**
   * Pull the raw `mail` configuration out of the config repository
   */
  protected getConfig(): Partial<MailConfig> {
    const configService = this.configService();

    if (!configService) {
      return {};
    }

    const section = configService.get('mail');

    return section && typeof section === 'object' ? (section as Partial<MailConfig>) : {};
  }

  /**
   * Resolve the config repository when the ConfigServiceProvider
   * registered one
   */
  protected configService(): ConfigClass | null {
    try {
      return this.app.bound('config') ? this.app.make<ConfigClass>('config') : null;
    } catch {
      return null;
    }
  }
}
