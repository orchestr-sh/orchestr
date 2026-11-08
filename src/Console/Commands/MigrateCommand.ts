/**
 * MigrateCommand
 *
 * Run the database migrations
 */

import type { Connection } from '@/Database/Connection';
import { Command, CommandOptions } from '@/Console/Command';
import { Migrator } from '@/Database/Migrations/Migrator';
import { SeederRunner } from '@/Database/Seeders/SeederRunner';
import { Application } from '@/Foundation/Application';

/**
 * Whether a parsed CLI flag was given. The kernel turns `--seed` into `true` and
 * `--seed=0` / `--seed=false` into strings, so both spellings of "off" are
 * honoured instead of being truthy text.
 */
function isEnabled(value: unknown): boolean {
  if (typeof value === 'string') {
    return value !== '' && value !== 'false' && value !== '0';
  }

  return Boolean(value);
}

export class MigrateCommand extends Command {
  signature = 'migrate';
  description = 'Run the database migrations';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const force = isEnabled(options.force);

    if (!force && this.app.environment() === 'production') {
      throw new Error('Refusing to run migrations in production. Pass --force to continue anyway.');
    }

    const db = this.app.make('db') as any;
    const connection = db.connection();
    const migrationPath = options.path || this.app.databasePath('migrations');
    const paths = Array.isArray(migrationPath) ? migrationPath : [migrationPath];

    const migrator = new Migrator(connection, paths);

    this.info('Running migrations...');
    this.newLine();

    try {
      const ran = await migrator.run({
        pretend: options.pretend === true,
        step: isEnabled(options.step),
      });

      if (ran.length === 0) {
        this.comment('Nothing to migrate.');
      } else {
        ran.forEach((migration) => {
          this.info(`Migrated: ${migration}`);
        });

        this.newLine();
        this.info('Migration completed successfully.');
      }

      if (isEnabled(options.seed)) {
        await this.seed(connection, options);
      }
    } catch (error) {
      this.error(`Migration failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Run the seeders after migrating, the way `migrate --seed` promises.
   */
  protected async seed(connection: Connection, options: CommandOptions): Promise<void> {
    const seederPath = options['seeders-path'] || './database/seeders';
    const paths = Array.isArray(seederPath) ? seederPath : [seederPath];

    this.newLine();
    this.info('Seeding database...');

    await new SeederRunner(connection, paths).run();

    this.info('Database seeding completed successfully.');
  }
}
