/**
 * QueueRetryCommand
 *
 * Retry a failed queue job.
 * Mirrors Laravel's `php artisan queue:retry`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import type { QueueManager } from '@/Queue/QueueManager';
import type { FailedJobProvider } from '@/Queue/Failed/FailedJobProvider';

export class QueueRetryCommand extends Command {
  signature = 'queue:retry <id>';
  description = 'Retry a failed queue job (use "all" to retry all)';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], _options: CommandOptions): Promise<void> {
    const id = args[0];

    if (!id) {
      this.error('Please specify a job ID or "all" to retry all failed jobs.');
      return;
    }

    const failer = this.getFailedJobProvider();

    if (!failer) {
      this.error('No failed job provider configured.');
      return;
    }

    const manager = this.app.make<QueueManager>('queue');

    if (id === 'all') {
      await this.retryAll(failer, manager);
      return;
    }

    const failedJob = await failer.find(id);

    if (!failedJob) {
      this.error(`Failed job [${id}] not found.`);
      return;
    }

    // Push the job back onto the queue
    const driver = manager.connection(failedJob.connection);
    await driver.pushRaw(failedJob.payload, failedJob.queue);

    // Remove from failed jobs
    await failer.forget(failedJob.id);

    this.info(`The failed job [${failedJob.uuid}] has been pushed back onto the queue.`);
  }

  protected async retryAll(failer: FailedJobProvider, manager: QueueManager): Promise<void> {
    const failedJobs = await failer.all();

    if (failedJobs.length === 0) {
      this.info('No failed jobs to retry.');
      return;
    }

    let retried = 0;

    for (const failedJob of failedJobs) {
      try {
        const driver = manager.connection(failedJob.connection);
        await driver.pushRaw(failedJob.payload, failedJob.queue);
        await failer.forget(failedJob.id);
        retried++;
      } catch (error) {
        this.error(`Failed to retry job [${failedJob.uuid}]: ${(error as Error).message}`);
      }
    }

    this.info(`Retried ${retried} failed job(s).`);
  }

  protected getFailedJobProvider(): FailedJobProvider | null {
    try {
      return this.app.make<FailedJobProvider>('queue.failer');
    } catch {
      return null;
    }
  }
}
