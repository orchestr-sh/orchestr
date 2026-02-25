/**
 * QueuePruneFailedCommand
 *
 * Prune stale entries from the failed jobs table.
 * Mirrors Laravel's `php artisan queue:prune-failed`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import type { FailedJobProvider } from '@/Queue/Failed/FailedJobProvider';

export class QueuePruneFailedCommand extends Command {
  signature = 'queue:prune-failed';
  description = 'Prune stale entries from the failed jobs table';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[], options: CommandOptions): Promise<void> {
    const hours = Number(options.hours) || 24;

    const failer = this.getFailedJobProvider();

    if (!failer) {
      this.error('No failed job provider configured.');
      return;
    }

    await failer.flush(hours);

    this.info(`Pruned failed jobs older than ${hours} hour(s).`);
  }

  protected getFailedJobProvider(): FailedJobProvider | null {
    try {
      return this.app.make<FailedJobProvider>('queue.failer');
    } catch {
      return null;
    }
  }
}
