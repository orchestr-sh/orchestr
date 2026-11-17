/**
 * NotificationServiceProvider
 *
 * Binds the NotificationSender into the container under `notifications` -
 * the key the `Notification.fake()` installer swaps out for a recorder -
 * assembling it from the `notifications` config section with
 * Laravel-style defaults. The channels themselves are the sender's
 * business (they ship with it, like the mail transports), so this
 * provider stays a thin configuration shell.
 *
 * Mirrors Laravel's Illuminate\Notifications\NotificationServiceProvider.
 *
 * @example
 * ```typescript
 * app.instance('config', new Config({ notifications: { queue: { connection: 'redis' } } }));
 * app.register(NotificationServiceProvider);
 *
 * await new User({ id: 1, email: 'ada@example.com' }).notify(new InvoicePaid(invoice));
 * ```
 */

import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import type { NotificationsConfig } from '@/Notifications/NotificationSender';
import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { NotificationSender } from '@/Notifications/NotificationSender';

export class NotificationServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton('notifications', () => new NotificationSender(this.getConfig(), this.app));
  }

  /**
   * The services provided by this provider
   */
  provides(): string[] {
    return ['notifications'];
  }

  /**
   * Pull the raw `notifications` configuration out of the config repository
   */
  protected getConfig(): Partial<NotificationsConfig> {
    const configService = this.configService();

    if (!configService) {
      return {};
    }

    const section = configService.get('notifications');

    return section && typeof section === 'object' ? (section as Partial<NotificationsConfig>) : {};
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
