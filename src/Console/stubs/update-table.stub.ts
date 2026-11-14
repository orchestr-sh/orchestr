/**
 * Update-table migration stub.
 *
 * Laravel: Illuminate\Database\Migrations\MigrationCreator
 * (update_table.stub).
 */
export default `import { Migration } from '@orchestr-sh/orchestr';
import { Schema } from '@orchestr-sh/orchestr';

export default class extends Migration {
  /**
   * Run the migrations
   */
  async up(schema: Schema): Promise<void> {
    await schema.table('{{ table }}', (table) => {
      //
    });
  }

  /**
   * Reverse the migrations
   */
  async down(schema: Schema): Promise<void> {
    await schema.table('{{ table }}', (table) => {
      //
    });
  }
}
`;
