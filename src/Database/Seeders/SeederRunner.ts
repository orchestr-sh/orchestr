/**
 * SeederRunner
 *
 * Runs database seeders
 */

import { Connection } from '@/Database/Connection';
import { Seeder } from './Seeder';
import * as fs from 'fs';
import * as path from 'path';

export class SeederRunner {
  constructor(
    protected connection: Connection,
    protected paths: string[]
  ) {}

  /**
   * Run a specific seeder class
   */
  async run(seederClass?: new () => Seeder): Promise<void> {
    let seeder: Seeder;

    if (seederClass) {
      seeder = new seederClass();
    } else {
      // Try to find DatabaseSeeder
      const DatabaseSeeder = await this.resolveDatabaseSeeder();
      seeder = new DatabaseSeeder();
    }

    seeder.setConnection(this.connection);
    await seeder.run();
  }

  /**
   * Run a seeder by name
   */
  async runByName(name: string): Promise<void> {
    const SeederClass = await this.resolveSeeder(name);
    await this.run(SeederClass);
  }

  /**
   * Resolve the DatabaseSeeder class
   */
  protected async resolveDatabaseSeeder(): Promise<new () => Seeder> {
    for (const searchPath of this.paths) {
      const databaseSeederPath = path.join(searchPath, 'DatabaseSeeder');

      // Try with .ts extension
      if (fs.existsSync(databaseSeederPath + '.ts')) {
        return await this.importSeeder(databaseSeederPath + '.ts');
      }

      // Try with .js extension
      if (fs.existsSync(databaseSeederPath + '.js')) {
        return await this.importSeeder(databaseSeederPath + '.js');
      }
    }

    throw new Error('DatabaseSeeder not found');
  }

  /**
   * Resolve a seeder class by name
   */
  protected async resolveSeeder(name: string): Promise<new () => Seeder> {
    for (const searchPath of this.paths) {
      const seederPath = path.join(searchPath, name);

      // Try with .ts extension
      if (fs.existsSync(seederPath + '.ts')) {
        return await this.importSeeder(seederPath + '.ts');
      }

      // Try with .js extension
      if (fs.existsSync(seederPath + '.js')) {
        return await this.importSeeder(seederPath + '.js');
      }
    }

    throw new Error(`Seeder not found: ${name}`);
  }

  /**
   * Import a seeder file
   */
  protected async importSeeder(filePath: string): Promise<new () => Seeder> {
    const seederModule = await import(filePath);

    // Get the default export or the first class export
    const SeederClass = seederModule.default || Object.values(seederModule)[0];

    if (!SeederClass) {
      throw new Error(`No seeder class found in: ${filePath}`);
    }

    return SeederClass as new () => Seeder;
  }

  /**
   * Set the seeder paths
   */
  setPaths(paths: string[]): void {
    this.paths = paths;
  }

  /**
   * Get the seeder paths
   */
  getPaths(): string[] {
    return this.paths;
  }
}
