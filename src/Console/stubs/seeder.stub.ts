/**
 * Seeder stub - the run() entrypoint SeederRunner awaits.
 *
 * Laravel: Illuminate\Foundation\Console\SeederMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

import { Seeder } from '@orchestr-sh/orchestr';

export default class {{ class }} extends Seeder {
  /**
   * Run the database seeds.
   */
  async run(): Promise<void> {
    // Example: insert rows through the connection
    // await this.connection?.table('users').insert({
    //   name: 'John Doe',
    //   email: 'john@example.com',
    // });
  }
}
`;
