/**
 * NotificationsTableCommand
 *
 * Create a migration for the notifications database table.
 * Mirrors Laravel's `php artisan notifications:table`.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';

export class NotificationsTableCommand extends Command {
  signature = 'notifications:table';
  description = 'Create a migration for the notifications database table';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[], options: CommandOptions): Promise<void> {
    const migrationsPath = (options.path as string) || this.app.databasePath('migrations');
    await fs.mkdir(migrationsPath, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const fileName = `${timestamp}_create_notifications_table.ts`;
    const filePath = path.join(migrationsPath, fileName);

    await fs.writeFile(filePath, this.getStub());

    this.info(`Migration created successfully: ${filePath}`);
    this.comment('Run "npx orchestr migrate" to create the table.');
  }

  protected getStub(): string {
    return `import { Migration } from '@orchestr-sh/orchestr';
import type { SchemaBuilder } from '@orchestr-sh/orchestr';

export default class CreateNotificationsTable extends Migration {
  async up(schema: SchemaBuilder): Promise<void> {
    await schema.create('notifications', (table) => {
      table.uuid('id').primary();
      table.string('type');
      table.morphs('notifiable');
      table.text('data');
      table.timestamp('read_at').nullable();
      table.timestamps();
    });
  }

  async down(schema: SchemaBuilder): Promise<void> {
    await schema.drop('notifications');
  }
}
`;
  }
}
