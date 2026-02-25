/**
 * QueueClearCommand
 *
 * Delete all of the jobs from the specified queue.
 * Mirrors Laravel's `php artisan queue:clear`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import type { QueueManager } from '@/Queue/QueueManager';

export class QueueClearCommand extends Command {
  signature = 'queue:clear [connection]';
  description = 'Delete all of the jobs from the specified queue';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const manager = this.app.make<QueueManager>('queue');
    const connection = args[0] || manager.getDefaultConnection();
    const queue = (options.queue as string) || 'default';

    const driver = manager.connection(connection);
    const count = await driver.clear(queue);

    this.info(`Cleared ${count} job(s) from the [${queue}] queue on [${connection}] connection.`);
  }
}
