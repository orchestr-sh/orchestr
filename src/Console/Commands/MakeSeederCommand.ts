/**
 * MakeSeederCommand
 *
 * Create a new seeder class
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import * as fs from 'fs';
import * as path from 'path';

export class MakeSeederCommand extends Command {
  signature = 'make:seeder <name>';
  description = 'Create a new seeder class';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const name = args[0];

    if (!name) {
      this.error('Seeder name is required.');
      this.line('Usage: make:seeder <name>');
      return;
    }

    const seederPath = options.path || './database/seeders';

    try {
      const filePath = await this.createSeeder(name, seederPath);

      this.info(`Seeder created successfully: ${filePath}`);
    } catch (error) {
      this.error(`Failed to create seeder: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Create a new seeder file
   */
  protected async createSeeder(name: string, seederPath: string): Promise<string> {
    // Ensure directory exists
    if (!fs.existsSync(seederPath)) {
      fs.mkdirSync(seederPath, { recursive: true });
    }

    const fileName = `${name}.ts`;
    const filePath = path.join(seederPath, fileName);

    if (fs.existsSync(filePath)) {
      throw new Error(`Seeder already exists: ${filePath}`);
    }

    const stub = this.getStub(name);
    fs.writeFileSync(filePath, stub);

    return filePath;
  }

  /**
   * Get the seeder stub
   */
  protected getStub(name: string): string {
    return `import { Seeder } from '@orchestr-sh/orchestr';

export default class ${name} extends Seeder {
  /**
   * Run the database seeds
   */
  async run(): Promise<void> {
    // Example: Insert data into database
    // await this.connection?.table('users').insert({
    //   name: 'John Doe',
    //   email: 'john@example.com',
    // });
  }
}
`;
  }
}
