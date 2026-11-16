import { Schema } from '@/Database/Contracts/Schema';
import { Migration } from '@/Database/Migrations/Migration';

/**
 * Fixture migration: a second table so the shared manager has a migration
 * history to run in order.
 */
export default class extends Migration {
  async up(schema: Schema): Promise<void> {
    await schema.create('posts', (table) => {
      table.id();
      table.string('title');
      table.timestamps();
    });
  }

  async down(schema: Schema): Promise<void> {
    await schema.drop('posts');
  }
}
