/**
 * QueueForgetCommand
 *
 * Delete a failed queue job.
 * Mirrors Laravel's `php artisan queue:forget`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import type { FailedJobProvider } from '@/Queue/Failed/FailedJobProvider';

export class QueueForgetCommand extends Command {
  signature = 'queue:forget <id>';
  description = 'Delete a failed queue job';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], _options: CommandOptions): Promise<void> {
    const id = args[0];

    if (!id) {
      this.error('Please specify a job ID.');
      return;
    }

    const failer = this.getFailedJobProvider();

    if (!failer) {
      this.error('No failed job provider configured.');
      return;
    }

    const deleted = await failer.forget(id);

    if (deleted) {
      this.info(`Failed job [${id}] deleted successfully.`);
    } else {
      this.error(`Failed job [${id}] not found.`);
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
