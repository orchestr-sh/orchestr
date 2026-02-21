/**
 * QueueWorkCommand
 *
 * Start processing jobs on the queue as a daemon.
 * Mirrors Laravel's `php artisan queue:work`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import type { QueueManager } from '@/Queue/QueueManager';
import type { Worker } from '@/Queue/Workers/Worker';

export class QueueWorkCommand extends Command {
  signature = 'queue:work [connection]';
  description = 'Start processing jobs on the queue as a daemon';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const manager = this.app.make<QueueManager>('queue');
    const worker = this.app.make<Worker>('queue.worker');

    const connection = args[0] || manager.getDefaultConnection();
    const queues = (options.queue as string) || 'default';
    const once = options.once === true || options.once === 'true';

    this.info(
      `[${new Date().toISOString()}] Processing jobs from the [${queues}] queue(s) on [${connection}] connection.`
    );

    const workerOptions = {
      name: (options.name as string) || 'default',
      sleep: Number(options.sleep) || 3,
      tries: Number(options.tries) || 1,
      timeout: Number(options.timeout) || 60,
      memory: Number(options.memory) || 128,
      maxJobs: Number(options['max-jobs']) || 0,
      maxTime: Number(options['max-time']) || 0,
      force: options.force === true || options.force === 'true',
      stopWhenEmpty: options['stop-when-empty'] === true || options['stop-when-empty'] === 'true',
      backoff: Number(options.backoff) || 0,
      rest: Number(options.rest) || 0,
    };

    if (once) {
      const processed = await worker.runOnce(connection, queues, workerOptions);
      if (!processed) {
        this.comment('No jobs available.');
      }
      return;
    }

    await worker.daemon(connection, queues, workerOptions);
    this.info('Worker stopped.');
  }
}
