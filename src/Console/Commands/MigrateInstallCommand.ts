/**
 * MigrateInstallCommand
 *
 * Create the migration repository
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Migrator } from '@/Database/Migrations/Migrator';
import { Application } from '@/Foundation/Application';

export class MigrateInstallCommand extends Command {
  signature = 'migrate:install';
  description = 'Create the migration repository';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const db = this.app.make('db') as any;
    const connection = db.connection();
    const migrationPath = options.path || this.app.databasePath('migrations');
    const paths = Array.isArray(migrationPath) ? migrationPath : [migrationPath];

    const migrator = new Migrator(connection, paths);

    try {
      await migrator.createRepository();

      this.info('Migration table created successfully.');
    } catch (error) {
      this.error(`Failed to create the migration repository: ${(error as Error).message}`);
      throw error;
    }
  }
}
