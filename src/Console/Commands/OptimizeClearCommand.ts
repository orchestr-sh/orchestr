/**
 * OptimizeClearCommand
 *
 * Remove every cache `optimize` writes: configuration snapshot, route
 * collection, and compiled views. Composes the individual clear commands
 * (DRY). Mirrors Laravel's `php artisan optimize:clear`.
 */

import { Application } from '@/Foundation/Application';
import type { CombinationStep } from './CacheCombinationCommand';
import { CacheCombinationCommand } from './CacheCombinationCommand';
import { ConfigClearCommand } from './ConfigClearCommand';
import { RouteClearCommand } from './RouteClearCommand';
import { ViewClearCommand } from './ViewClearCommand';

export class OptimizeClearCommand extends CacheCombinationCommand {
  signature = 'optimize:clear';
  description = 'Remove the cached bootstrap files (config, routes, views)';

  constructor(app: Application) {
    super(app);
  }

  protected steps(): CombinationStep[] {
    return [
      { name: 'config:clear', create: () => new ConfigClearCommand(this.app) },
      // Clearing the snapshot is a file operation; no router needed.
      { name: 'route:clear', create: () => new RouteClearCommand(this.app) },
      { name: 'view:clear', requires: 'view', create: () => new ViewClearCommand(this.app) },
    ];
  }
}
