/**
 * Create-table migration stub.
 *
 * Laravel: Illuminate\Database\Migrations\MigrationCreator
 * (create_table.stub).
 */
export default `import { Migration } from '@orchestr-sh/orchestr';
import { Schema } from '@orchestr-sh/orchestr';

export default class extends Migration {
  /**
   * Run the migrations
   */
  async up(schema: Schema): Promise<void> {
    await schema.create('{{ table }}', (table) => {
      table.id();
      table.timestamps();
    });
  }

  /**
   * Reverse the migrations
   */
  async down(schema: Schema): Promise<void> {
    await schema.dropIfExists('{{ table }}');
  }
}
`;
