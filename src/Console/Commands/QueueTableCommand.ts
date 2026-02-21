/**
 * QueueTableCommand
 *
 * Create a migration for the queue jobs database table.
 * Mirrors Laravel's `php artisan queue:table`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import * as fs from 'fs/promises';
import * as path from 'path';

export class QueueTableCommand extends Command {
  signature = 'queue:table';
  description = 'Create a migration for the queue jobs database table';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[], options: CommandOptions): Promise<void> {
    const migrationsPath = (options.path as string) || this.app.databasePath('migrations');
    await fs.mkdir(migrationsPath, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const fileName = `${timestamp}_create_jobs_table.ts`;
    const filePath = path.join(migrationsPath, fileName);

    await fs.writeFile(filePath, this.getStub());

    this.info(`Migration created successfully: ${filePath}`);
    this.comment('Run "npx orchestr migrate" to create the table.');
  }

  protected getStub(): string {
    return `import { Migration } from '@orchestr-sh/orchestr';
import type { SchemaBuilder } from '@orchestr-sh/orchestr';

export default class CreateJobsTable extends Migration {
  async up(schema: SchemaBuilder): Promise<void> {
    await schema.create('jobs', (table) => {
      table.bigIncrements('id');
      table.string('queue').index();
      table.text('payload');
      table.integer('attempts').defaultTo(0);
      table.integer('reserved_at').nullable();
      table.integer('available_at');
      table.integer('created_at');
    });
  }

  async down(schema: SchemaBuilder): Promise<void> {
    await schema.drop('jobs');
  }
}
`;
  }
}
