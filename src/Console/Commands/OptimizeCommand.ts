/**
 * OptimizeCommand
 *
 * Cache everything that makes the application faster to boot: the
 * configuration snapshot, the route collection, and the compiled views.
 * Composes the individual cache commands (DRY) rather than touching their
 * writers. Mirrors Laravel's `php artisan optimize`.
 */

import { Application } from '@/Foundation/Application';
import type { CombinationStep } from './CacheCombinationCommand';
import { CacheCombinationCommand } from './CacheCombinationCommand';
import { ConfigCacheCommand } from './ConfigCacheCommand';
import { RouteCacheCommand } from './RouteCacheCommand';
import { ViewCacheCommand } from './ViewCacheCommand';

export class OptimizeCommand extends CacheCombinationCommand {
  signature = 'optimize';
  description = 'Cache the framework configuration, routes, and views';

  constructor(app: Application) {
    super(app);
  }

  protected steps(): CombinationStep[] {
    return [
      { name: 'config:cache', create: () => new ConfigCacheCommand(this.app) },
      { name: 'route:cache', requires: 'router', create: () => new RouteCacheCommand(this.app) },
      { name: 'view:cache', requires: 'view', create: () => new ViewCacheCommand(this.app) },
    ];
  }
}
