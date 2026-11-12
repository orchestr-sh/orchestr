/**
 * ConfigClearCommand
 *
 * Remove the cached configuration snapshot written by `config:cache` so the
 * next boot loads the original config files again.
 * Mirrors Laravel's `php artisan config:clear`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { ConfigLoader } from '@/Foundation/Config/ConfigLoader';

export class ConfigClearCommand extends Command {
  signature = 'config:clear';
  description = 'Remove the cached configuration file';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[] = [], _options: CommandOptions = {}): Promise<void> {
    const loader = new ConfigLoader(this.app);

    if (loader.clearCache()) {
      this.info('Configuration cache cleared!');
      return;
    }

    this.comment('No configuration cache was found, nothing to clear.');
  }
}
