/**
 * QueueFailedTableCommand
 *
 * Create a migration for the failed queue jobs database table.
 * Mirrors Laravel's `php artisan queue:failed-table`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import * as fs from 'fs/promises';
import * as path from 'path';

export class QueueFailedTableCommand extends Command {
  signature = 'queue:failed-table';
  description = 'Create a migration for the failed queue jobs database table';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[], options: CommandOptions): Promise<void> {
    const migrationsPath = (options.path as string) || this.app.databasePath('migrations');
    await fs.mkdir(migrationsPath, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const fileName = `${timestamp}_create_failed_jobs_table.ts`;
    const filePath = path.join(migrationsPath, fileName);

    await fs.writeFile(filePath, this.getStub());

    this.info(`Migration created successfully: ${filePath}`);
    this.comment('Run "npx orchestr migrate" to create the table.');
  }

  protected getStub(): string {
    return `import { Migration } from '@orchestr-sh/orchestr';
import type { SchemaBuilder } from '@orchestr-sh/orchestr';

export default class CreateFailedJobsTable extends Migration {
  async up(schema: SchemaBuilder): Promise<void> {
    await schema.create('failed_jobs', (table) => {
      table.bigIncrements('id');
      table.string('uuid').unique();
      table.text('connection');
      table.text('queue');
      table.text('payload');
      table.text('exception');
      table.timestamp('failed_at').defaultTo(new Date().toISOString());
    });
  }

  async down(schema: SchemaBuilder): Promise<void> {
    await schema.drop('failed_jobs');
  }
}
`;
  }
}
