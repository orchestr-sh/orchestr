/**
 * QueueFlushCommand
 *
 * Flush all of the failed queue jobs.
 * Mirrors Laravel's `php artisan queue:flush`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import type { FailedJobProvider } from '@/Queue/Failed/FailedJobProvider';

export class QueueFlushCommand extends Command {
  signature = 'queue:flush';
  description = 'Flush all of the failed queue jobs';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[], options: CommandOptions): Promise<void> {
    const failer = this.getFailedJobProvider();

    if (!failer) {
      this.error('No failed job provider configured.');
      return;
    }

    const hours = options.hours ? Number(options.hours) : undefined;

    await failer.flush(hours);

    if (hours) {
      this.info(`All failed jobs older than ${hours} hour(s) have been deleted.`);
    } else {
      this.info('All failed jobs deleted successfully.');
    }
  }

  protected getFailedJobProvider(): FailedJobProvider | null {
    try {
      return this.app.make<FailedJobProvider>('queue.failer');
    } catch {
      return null;
    }
  }
}
