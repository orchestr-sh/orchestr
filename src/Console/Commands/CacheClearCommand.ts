/**
 * CacheClearCommand
 *
 * Flush the application cache.
 * Mirrors Laravel's `php artisan cache:clear`.
 */

import { Command, CommandOptions } from '../Command';
import { Application } from '../../Foundation/Application';
import type { CacheManager } from '../../Cache/CacheManager';

export class CacheClearCommand extends Command {
  signature = 'cache:clear [store]';
  description = 'Flush the application cache';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], _options: CommandOptions): Promise<void> {
    const manager = this.app.make<CacheManager>('cache');
    const storeName = args[0] || undefined;

    const store = manager.store(storeName);
    const success = await store.flush();

    if (success) {
      this.info(`Application cache cleared successfully${storeName ? ` [${storeName}]` : ''}.`);
    } else {
      this.error('Failed to clear the application cache.');
    }
  }
}
