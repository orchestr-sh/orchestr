/**
 * ViewCacheCommand
 *
 * Compile all views into the compiled-view cache up front so the first
 * request after deploy never pays the parse cost. Mirrors Laravel's
 * `php artisan view:cache`.
 */

import type { ViewFactory } from '@/View/ViewFactory';
import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';

export class ViewCacheCommand extends Command {
  signature = 'view:cache';
  description = 'Compile all views in the application';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[] = [], _options: CommandOptions = {}): Promise<void> {
    if (!this.app.bound('view')) {
      this.error('The view service is not registered; cannot compile views.');
      return;
    }

    const factory = this.app.make<ViewFactory>('view');

    try {
      const compiled = factory.compileAll();
      this.info('Blade-compatible views compiled and cached successfully!');
      this.newLine();
      this.comment(
        `Compiled ${compiled} template${compiled === 1 ? '' : 's'} from: ${factory.getPaths().join(', ') || '(no view paths)'}`
      );
    } catch (error) {
      this.error((error as Error).message);
    }
  }
}
