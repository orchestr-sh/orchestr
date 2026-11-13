/**
 * ConfigCacheCommand
 *
 * Build a serializable snapshot of the application's configuration files
 * into `bootstrap/cache/config.json` so boots skip importing config/*.ts
 * entirely. Mirrors Laravel's `php artisan config:cache`.
 *
 * Note: like Laravel, the snapshot only contains what config files (and the
 * cache-aware loader) can represent; runtime `config([...])` overrides set
 * after boot are re-applied on every boot regardless.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { ConfigLoader } from '@/Foundation/Config/ConfigLoader';

export class ConfigCacheCommand extends Command {
  signature = 'config:cache';
  description = 'Save the framework configuration files to a single cached file';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[] = [], _options: CommandOptions = {}): Promise<void> {
    const loader = new ConfigLoader(this.app);

    let items: Record<string, any>;
    let path: string;

    try {
      // Always rebuild from the source files, even when a stale snapshot of
      // a previous run is still in place.
      items = await loader.loadFiles();
      path = loader.cache(items);
    } catch (error) {
      this.error((error as Error).message);
      return;
    }

    if (Object.keys(items).length === 0) {
      this.warn(`No configuration files found in [${this.app.configPath()}].`);
    }

    this.info('Configuration cached successfully!');
    this.newLine();
    this.comment(`Cached to: ${path}`);
  }
}
