/**
 * ViewClearCommand
 *
 * Delete every compiled view from the cache directory so changed templates
 * are guaranteed to reparse. Mirrors Laravel's `php artisan view:clear`.
 */

import type { ViewFactory } from '@/View/ViewFactory';
import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';

export class ViewClearCommand extends Command {
  signature = 'view:clear';
  description = 'Delete all compiled view files';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[] = [], _options: CommandOptions = {}): Promise<void> {
    if (!this.app.bound('view')) {
      this.error('The view service is not registered; there are no compiled views to clear.');
      return;
    }

    try {
      const factory = this.app.make<ViewFactory>('view');
      const removed = factory.clearCompiled();

      this.info('Compiled views cleared!');
      this.newLine();
      this.comment(`Removed ${removed} cache file${removed === 1 ? '' : 's'}`);
    } catch (error) {
      this.error((error as Error).message);
    }
  }
}
