/**
 * CacheTableCommand
 *
 * Create a migration for the cache database table.
 * Mirrors Laravel's `php artisan cache:table`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import * as fs from 'fs/promises';
import * as path from 'path';

export class CacheTableCommand extends Command {
  signature = 'cache:table';
  description = 'Create a migration for the cache database table';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[], options: CommandOptions): Promise<void> {
    const migrationsPath = (options.path as string) || this.app.databasePath('migrations');
    await fs.mkdir(migrationsPath, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const fileName = `${timestamp}_create_cache_table.ts`;
    const filePath = path.join(migrationsPath, fileName);

    await fs.writeFile(filePath, this.getStub());

    this.info(`Migration created successfully: ${filePath}`);
    this.comment('Run "npx orchestr migrate" to create the table.');
  }

  protected getStub(): string {
    return `import { Migration } from '@orchestr-sh/orchestr';
import type { SchemaBuilder } from '@orchestr-sh/orchestr';

export default class CreateCacheTable extends Migration {
  async up(schema: SchemaBuilder): Promise<void> {
    await schema.create('cache', (table) => {
      table.string('key').primary();
      table.text('value');
      table.integer('expiration');
    });

    await schema.create('cache_locks', (table) => {
      table.string('key').primary();
      table.string('owner');
      table.integer('expiration');
    });
  }

  async down(schema: SchemaBuilder): Promise<void> {
    await schema.drop('cache_locks');
    await schema.drop('cache');
  }
}
`;
  }
}
