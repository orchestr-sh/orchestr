/**
 * MigrateRefreshCommand
 *
 * Reset and re-run all migrations
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { Migrator } from '@/Database/Migrations/Migrator';

export class MigrateRefreshCommand extends Command {
  signature = 'migrate:refresh';
  description = 'Reset and re-run all migrations';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const db = this.app.make('db') as any;
    const connection = db.connection();
    const migrationPath = options.path || './database/migrations';
    const paths = Array.isArray(migrationPath) ? migrationPath : [migrationPath];

    const migrator = new Migrator(connection, paths);

    this.info('Refreshing database...');
    this.newLine();

    try {
      const result = await migrator.refresh();

      if (result.rolledBack.length > 0) {
        this.comment('Rolled back:');
        result.rolledBack.forEach((migration) => {
          this.info(`  ${migration}`);
        });
        this.newLine();
      }

      if (result.ran.length > 0) {
        this.comment('Migrated:');
        result.ran.forEach((migration) => {
          this.info(`  ${migration}`);
        });
        this.newLine();
      }

      this.info(`Database refresh completed successfully.`);
    } catch (error) {
      this.error(`Refresh failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
