/**
 * MakeMigrationCommand
 *
 * Create a new migration file
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { MigrationCreator } from '@/Database/Migrations/MigrationCreator';

export class MakeMigrationCommand extends Command {
  signature = 'make:migration <name>';
  description = 'Create a new migration file';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const name = args[0];

    if (!name) {
      this.error('Migration name is required.');
      this.line('Usage: make:migration <name>');
      return;
    }

    const migrationPath = options.path || './database/migrations';
    const table = options.table as string | undefined;
    const create = options.create === true;

    const creator = new MigrationCreator();

    try {
      const filePath = await creator.create(name, migrationPath, table, create);

      this.info(`Migration created successfully: ${filePath}`);
    } catch (error) {
      this.error(`Failed to create migration: ${(error as Error).message}`);
      throw error;
    }
  }
}
