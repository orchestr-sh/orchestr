/**
 * RouteClearCommand
 *
 * Remove the cached route collection written by `route:cache` so the next
 * boot loads the original route files again. Mirrors Laravel's
 * `php artisan route:clear`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { RouteCache } from '@/Routing/RouteCache';

export class RouteClearCommand extends Command {
  signature = 'route:clear';
  description = 'Remove the cached route file';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[] = [], _options: CommandOptions = {}): Promise<void> {
    const cache = new RouteCache(this.app);

    if (cache.clear()) {
      this.info('Route cache cleared!');
      return;
    }

    this.comment('No route cache was found, nothing to clear.');
  }
}
