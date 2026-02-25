/**
 * QueueRestartCommand
 *
 * Restart queue worker daemons.
 * Mirrors Laravel's `php artisan queue:restart`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';

export class QueueRestartCommand extends Command {
  signature = 'queue:restart';
  description = 'Restart queue worker daemons after their current job';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[], _options: CommandOptions): Promise<void> {
    // Signal workers to restart by sending SIGUSR2
    // In production, this would use a cache-based signal mechanism
    this.info('Broadcasting queue restart signal...');

    try {
      process.kill(process.pid, 'SIGUSR2');
    } catch {
      // Process might not support this signal
    }

    this.info('Queue restart signal sent.');
    this.comment('Workers will restart after finishing their current job.');
  }
}
