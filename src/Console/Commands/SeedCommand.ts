/**
 * SeedCommand
 *
 * Seed the database with records
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { SeederRunner } from '@/Database/Seeders/SeederRunner';

export class SeedCommand extends Command {
  signature = 'db:seed';
  description = 'Seed the database with records';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const db = this.app.make('db') as any;
    const connection = db.connection();
    const seederPath = options.path || './database/seeders';
    const paths = Array.isArray(seederPath) ? seederPath : [seederPath];

    const runner = new SeederRunner(connection, paths);

    this.info('Seeding database...');
    this.newLine();

    try {
      const className = options.class as string | undefined;

      if (className) {
        await runner.runByName(className);
      } else {
        await runner.run();
      }

      this.info('Database seeding completed successfully.');
    } catch (error) {
      this.error(`Seeding failed: ${(error as Error).message}`);
      throw error;
    }
  }
}
