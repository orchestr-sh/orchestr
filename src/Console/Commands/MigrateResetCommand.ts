/**
 * MigrateResetCommand
 *
 * Rollback all database migrations
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { Migrator } from '@/Database/Migrations/Migrator';

export class MigrateResetCommand extends Command {
  signature = 'migrate:reset';
  description = 'Rollback all database migrations';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const db = this.app.make('db') as any;
    const connection = db.connection();
    const migrationPath = options.path || './database/migrations';
    const paths = Array.isArray(migrationPath) ? migrationPath : [migrationPath];

    const migrator = new Migrator(connection, paths);

    this.info('Resetting database...');
    this.newLine();

    try {
      const rolledBack = await migrator.reset();

      if (rolledBack.length === 0) {
        this.comment('Nothing to rollback.');
        return;
      }

      rolledBack.forEach((migration) => {
        this.info(`Rolled back: ${migration}`);
      });

      this.newLine();
      this.info(`Database reset completed successfully.`);
    } catch (error) {
      this.error(`Reset failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
