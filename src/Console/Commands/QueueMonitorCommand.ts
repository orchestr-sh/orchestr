/**
 * QueueMonitorCommand
 *
 * Monitor the size of the specified queues.
 * Mirrors Laravel's `php artisan queue:monitor`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import type { QueueManager } from '@/Queue/QueueManager';

export class QueueMonitorCommand extends Command {
  signature = 'queue:monitor [queues]';
  description = 'Monitor the size of the specified queues';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const manager = this.app.make<QueueManager>('queue');
    const queuesArg = args[0] || 'default';
    const max = Number(options.max) || 1000;

    const queuePairs = queuesArg.split(',').map((q) => q.trim());

    this.info('Queue Monitor');
    this.newLine();

    for (const queuePair of queuePairs) {
      // Format: connection:queue or just queue
      const parts = queuePair.split(':');
      const connection = parts.length > 1 ? parts[0] : manager.getDefaultConnection();
      const queue = parts.length > 1 ? parts[1] : parts[0];

      const driver = manager.connection(connection);
      const size = await driver.size(queue);

      const status = size > max ? '\x1b[31mALERT\x1b[0m' : '\x1b[32mOK\x1b[0m';

      this.line(`  [${connection}:${queue}] ${size} job(s) ${status}`);

      if (size > max) {
        this.warn(`  Queue [${connection}:${queue}] has ${size} jobs, which exceeds the maximum of ${max}.`);
      }
    }
  }
}
