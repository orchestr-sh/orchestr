/**
 * DbWipeCommand
 *
 * Drop every table in the application's database. Mirrors Laravel's
 * `php artisan db:wipe` - and reuses the Migrator that already owns the
 * "introspect tables, disable constraints, drop them all" logic behind
 * `migrate:fresh`.
 *
 * Fully destructive, so it goes through the shared gate: confirm
 * interactively, `--force` in non-interactive sessions.
 */

import type { DatabaseManager } from '@/Database/DatabaseManager';
import { Command, CommandOptions } from '@/Console/Command';
import { Migrator } from '@/Database/Migrations/Migrator';
import { Application } from '@/Foundation/Application';

export class DbWipeCommand extends Command {
  signature =
    'db:wipe {--database= : The database connection to wipe} {--force : Force the operation to run without confirmation}';
  description = 'Drop all tables in the database';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[] = [], options: CommandOptions = {}): Promise<void> {
    if (
      !(await this.confirmToProceed(
        options,
        'This will drop every table in the database. Are you sure you want to continue?'
      ))
    ) {
      this.comment('Database wipe cancelled.');
      return;
    }

    if (!this.app.bound('db')) {
      this.error('The database service is not registered; there is nothing to wipe.');
      return;
    }

    const db = this.app.make<DatabaseManager>('db');
    const connectionName = typeof options.database === 'string' ? options.database : undefined;
    const connection = db.connection(connectionName);

    // An empty migration list is fine: dropAllTables never touches files.
    const migrator = new Migrator(connection, []);

    this.info('Dropping all tables...');

    try {
      await migrator.dropAllTables();
    } catch (error) {
      this.error(`Database wipe failed: ${(error as Error).message}`);
      throw error;
    }

    this.success('Database wiped successfully.');
  }
}
