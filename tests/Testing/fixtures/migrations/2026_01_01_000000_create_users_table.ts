import { Schema } from '@/Database/Contracts/Schema';
import { Migration } from '@/Database/Migrations/Migration';

/**
 * Fixture migration: the users table the RefreshDatabase suite asserts
 * against, including the soft-delete column.
 */
export default class extends Migration {
  async up(schema: Schema): Promise<void> {
    await schema.create('users', (table) => {
      table.id();
      table.string('name');
      table.string('email').nullable();
      table.softDeletes();
      table.timestamps();
    });
  }

  async down(schema: Schema): Promise<void> {
    await schema.drop('users');
  }
}
