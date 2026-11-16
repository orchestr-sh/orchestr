/**
 * RouteCacheCommand
 *
 * Serialize the application's route collection into
 * `bootstrap/cache/routes.json` so subsequent boots hydrate the router from
 * the snapshot instead of importing and evaluating the route files. Mirrors
 * Laravel's `php artisan route:cache`.
 *
 * All serializing logic lives in RouteCache; this command boots the app,
 * triggers the write, and reports.
 */

import type { Router } from '@/Routing/Router';
import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { RouteCache } from '@/Routing/RouteCache';

export class RouteCacheCommand extends Command {
  signature = 'route:cache';
  description = 'Save the framework routes to a single cached file';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[] = [], _options: CommandOptions = {}): Promise<void> {
    // The collection only exists once providers have registered route files
    // (or hydrated a previous snapshot), so boot first like Artisan does.
    await this.app.boot();

    if (!this.app.bound('router')) {
      this.error('The router is not registered; there are no routes to cache.');
      return;
    }

    const router = this.app.make<Router>('router');
    const cache = new RouteCache(this.app);

    try {
      const path = cache.cache(router);

      this.info('Routes cached successfully!');
      this.newLine();
      this.comment(`Cached to: ${path}`);
    } catch (error) {
      this.error((error as Error).message);
    }
  }
}
