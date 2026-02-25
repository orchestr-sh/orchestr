/**
 * MigrateStatusCommand
 *
 * Show the status of each migration
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { Migrator } from '@/Database/Migrations/Migrator';

export class MigrateStatusCommand extends Command {
  signature = 'migrate:status';
  description = 'Show the status of each migration';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const db = this.app.make('db') as any;
    const connection = db.connection();
    const migrationPath = options.path || './database/migrations';
    const paths = Array.isArray(migrationPath) ? migrationPath : [migrationPath];

    const migrator = new Migrator(connection, paths);

    try {
      const ran = await migrator.getRan();
      const batches = await migrator.getMigrationBatches();
      const files = await migrator.getMigrationFiles();

      if (files.length === 0) {
        this.comment('No migrations found.');
        return;
      }

      this.info('Migration status:');
      this.newLine();

      // Calculate column widths
      const maxLength = Math.max(...files.map((f) => f.length));
      const statusWidth = 6;
      const batchWidth = 5;

      // Print header
      this.line(`${'Migration'.padEnd(maxLength + 2)}  ${'Ran?'.padEnd(statusWidth)}  ${'Batch'.padEnd(batchWidth)}`);
      this.line('-'.repeat(maxLength + statusWidth + batchWidth + 8));

      // Print migrations
      files.forEach((file) => {
        const hasRan = ran.includes(file);
        const batch = batches[file] || '-';
        const status = hasRan ? '\x1b[32mYes\x1b[0m' : '\x1b[31mNo\x1b[0m';

        this.line(`${file.padEnd(maxLength + 2)}  ${status.padEnd(statusWidth + 9)}  ${batch}`);
      });

      this.newLine();
    } catch (error) {
      this.error(`Failed to get migration status: ${(error as Error).message}`);
      throw error;
    }
  }
}
