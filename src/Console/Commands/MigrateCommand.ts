/**
 * MigrateCommand
 *
 * Run the database migrations
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { Migrator } from '@/Database/Migrations/Migrator';

export class MigrateCommand extends Command {
  signature = 'migrate';
  description = 'Run the database migrations';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const db = this.app.make('db') as any;
    const connection = db.connection();
    const migrationPath = options.path || './database/migrations';
    const paths = Array.isArray(migrationPath) ? migrationPath : [migrationPath];

    const migrator = new Migrator(connection, paths);

    this.info('Running migrations...');
    this.newLine();

    try {
      const ran = await migrator.run({
        pretend: options.pretend === true,
      });

      if (ran.length === 0) {
        this.comment('Nothing to migrate.');
        return;
      }

      ran.forEach((migration) => {
        this.info(`Migrated: ${migration}`);
      });

      this.newLine();
      this.info(`Migration completed successfully.`);
    } catch (error) {
      this.error(`Migration failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
