/**
 * UpCommand
 *
 * Bring the application out of maintenance mode by clearing the state
 * through `Application.maintenanceMode()` - the same storage the
 * middleware, the queue worker and the scheduler read (DRY).
 *
 * Mirrors Laravel's `php artisan up`; succeeding when the application was
 * not down at all.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';

export class UpCommand extends Command {
  signature = 'up';
  description = 'Bring the application out of maintenance mode';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[] = [], _options: CommandOptions = {}): Promise<void> {
    this.app.maintenanceMode().deactivate();

    this.info('Application is now live.');
  }
}
