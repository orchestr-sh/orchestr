/**
 * CacheForgetCommand
 *
 * Remove an item from the cache.
 * Mirrors Laravel's `php artisan cache:forget`.
 */

import { Command, CommandOptions } from '../Command';
import { Application } from '../../Foundation/Application';
import type { CacheManager } from '../../Cache/CacheManager';

export class CacheForgetCommand extends Command {
  signature = 'cache:forget <key> [store]';
  description = 'Remove an item from the cache';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], _options: CommandOptions): Promise<void> {
    const key = args[0];
    const storeName = args[1] || undefined;

    if (!key) {
      this.error('Cache key is required.');
      this.line('Usage: cache:forget <key> [store]');
      return;
    }

    const manager = this.app.make<CacheManager>('cache');
    const store = manager.store(storeName);

    const forgotten = await store.forget(key);

    if (forgotten) {
      this.info(`The [${key}] key has been removed from the cache.`);
    } else {
      this.comment(`The [${key}] key was not found in the cache.`);
    }
  }
}
