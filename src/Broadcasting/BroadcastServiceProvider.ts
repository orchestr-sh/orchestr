/**
 * BroadcastServiceProvider
 *
 * Binds the BroadcastManager into the container under `broadcast` - the key
 * the `Broadcast` facade, the `broadcast()` helper and the notification
 * broadcast channel all resolve - assembling it from the `broadcasting` config
 * section with Laravel-style defaults. The drivers ship with the manager (like
 * the mail transports), so this provider stays a thin configuration shell.
 *
 * Mirrors Laravel's Illuminate\Broadcasting\BroadcastServiceProvider.
 *
 * @example
 * ```typescript
 * app.instance('config', new Config({ broadcasting: { default: 'log' } }));
 * app.register(BroadcastServiceProvider);
 *
 * await broadcast().broadcast('orders.1', 'OrderShipped', { id: 1 });
 * ```
 */

import type { BroadcastConfig } from '@/Broadcasting/BroadcastManager';
import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import { BroadcastManager } from '@/Broadcasting/BroadcastManager';
import { ServiceProvider } from '@/Foundation/ServiceProvider';

export class BroadcastServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton('broadcast', () => new BroadcastManager(this.getConfig(), this.app));
  }

  /**
   * The services provided by this provider
   */
  provides(): string[] {
    return ['broadcast'];
  }

  /**
   * Pull the raw `broadcasting` configuration out of the config repository
   */
  protected getConfig(): Partial<BroadcastConfig> {
    const configService = this.configService();

    if (!configService) {
      return {};
    }

    const section = configService.get('broadcasting');

    return section && typeof section === 'object' ? (section as Partial<BroadcastConfig>) : {};
  }

  /**
   * Resolve the config repository when the ConfigServiceProvider registered one
   */
  protected configService(): ConfigClass | null {
    try {
      return this.app.bound('config') ? this.app.make<ConfigClass>('config') : null;
    } catch {
      return null;
    }
  }
}
