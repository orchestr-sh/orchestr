/**
 * MigrateRollbackCommand
 *
 * Rollback the last database migration
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { Migrator } from '@/Database/Migrations/Migrator';

export class MigrateRollbackCommand extends Command {
  signature = 'migrate:rollback';
  description = 'Rollback the last database migration';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const db = this.app.make('db') as any;
    const connection = db.connection();
    const migrationPath = options.path || './database/migrations';
    const paths = Array.isArray(migrationPath) ? migrationPath : [migrationPath];

    const migrator = new Migrator(connection, paths);

    this.info('Rolling back migrations...');
    this.newLine();

    try {
      const rolledBack = await migrator.rollback({
        step: options.step ? parseInt(options.step as string, 10) : undefined,
        pretend: options.pretend === true,
      });

      if (rolledBack.length === 0) {
        this.comment('Nothing to rollback.');
        return;
      }

      rolledBack.forEach((migration) => {
        this.info(`Rolled back: ${migration}`);
      });

      this.newLine();
      this.info(`Rollback completed successfully.`);
    } catch (error) {
      this.error(`Rollback failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
