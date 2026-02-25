/**
 * MigrateFreshCommand
 *
 * Drop all tables and re-run all migrations
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { Migrator } from '@/Database/Migrations/Migrator';
import { SchemaBuilder } from '@/Database/Migrations/SchemaBuilder';

export class MigrateFreshCommand extends Command {
  signature = 'migrate:fresh';
  description = 'Drop all tables and re-run all migrations';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const db = this.app.make('db') as any;
    const connection = db.connection();
    const migrationPath = options.path || './database/migrations';
    const paths = Array.isArray(migrationPath) ? migrationPath : [migrationPath];

    const schema = new SchemaBuilder(connection);
    const migrator = new Migrator(connection, paths);

    this.warn('This command will drop all tables. Are you sure you want to continue?');
    this.newLine();

    try {
      // Drop all tables
      this.info('Dropping all tables...');
      const repository = migrator.getRepository();
      await repository.deleteRepository();
      this.newLine();

      // Re-run all migrations
      this.info('Running migrations...');
      this.newLine();

      const ran = await migrator.run();

      if (ran.length > 0) {
        ran.forEach((migration) => {
          this.info(`Migrated: ${migration}`);
        });
        this.newLine();
      }

      this.info(`Database fresh completed successfully.`);
    } catch (error) {
      this.error(`Fresh migration failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
