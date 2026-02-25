/**
 * QueuePruneBatchesCommand
 *
 * Prune stale entries from the batches database.
 * Mirrors Laravel's `php artisan queue:prune-batches`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import type { DatabaseManager } from '@/Database/DatabaseManager';

export class QueuePruneBatchesCommand extends Command {
  signature = 'queue:prune-batches';
  description = 'Prune stale entries from the batches database';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[], options: CommandOptions): Promise<void> {
    const hours = Number(options.hours) || 24;
    const cutoff = Math.floor(Date.now() / 1000) - hours * 60 * 60;

    try {
      const db = this.app.make<DatabaseManager>('db');
      const connection = db.connection();
      const table = (options.table as string) || 'job_batches';

      // Delete finished batches older than the cutoff
      await connection.table(table).whereNotNull('finished_at').where('finished_at', '<=', cutoff).delete();

      // Also delete cancelled batches older than the cutoff
      await connection.table(table).whereNotNull('cancelled_at').where('cancelled_at', '<=', cutoff).delete();

      this.info(`Pruned batches older than ${hours} hour(s).`);
    } catch (error) {
      this.error(`Failed to prune batches: ${(error as Error).message}`);
    }
  }
}
