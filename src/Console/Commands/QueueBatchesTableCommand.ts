/**
 * QueueBatchesTableCommand
 *
 * Create a migration for the batches database table.
 * Mirrors Laravel's `php artisan queue:batches-table`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import * as fs from 'fs/promises';
import * as path from 'path';

export class QueueBatchesTableCommand extends Command {
  signature = 'queue:batches-table';
  description = 'Create a migration for the batches database table';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[], options: CommandOptions): Promise<void> {
    const migrationsPath = (options.path as string) || this.app.databasePath('migrations');
    await fs.mkdir(migrationsPath, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const fileName = `${timestamp}_create_job_batches_table.ts`;
    const filePath = path.join(migrationsPath, fileName);

    await fs.writeFile(filePath, this.getStub());

    this.info(`Migration created successfully: ${filePath}`);
    this.comment('Run "npx orchestr migrate" to create the table.');
  }

  protected getStub(): string {
    return `import { Migration } from '@orchestr-sh/orchestr';
import type { SchemaBuilder } from '@orchestr-sh/orchestr';

export default class CreateJobBatchesTable extends Migration {
  async up(schema: SchemaBuilder): Promise<void> {
    await schema.create('job_batches', (table) => {
      table.string('id').primary();
      table.string('name');
      table.integer('total_jobs');
      table.integer('pending_jobs');
      table.integer('failed_jobs');
      table.text('failed_job_ids');
      table.text('options').nullable();
      table.integer('cancelled_at').nullable();
      table.integer('created_at');
      table.integer('finished_at').nullable();
    });
  }

  async down(schema: SchemaBuilder): Promise<void> {
    await schema.drop('job_batches');
  }
}
`;
  }
}
