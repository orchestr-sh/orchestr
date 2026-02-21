/**
 * Migrator
 *
 * Handles running and rolling back migrations
 */

import { Connection } from '@/Database/Connection';
import { MigrationRepository } from './MigrationRepository';
import { Migration } from './Migration';
import { SchemaBuilder } from './SchemaBuilder';
import * as path from 'path';
import * as fs from 'fs';

export interface MigrationOptions {
  step?: number;
  pretend?: boolean;
}

export class Migrator {
  protected repository: MigrationRepository;
  protected schema: SchemaBuilder;

  constructor(
    protected connection: Connection,
    protected paths: string[]
  ) {
    this.repository = new MigrationRepository(connection);
    this.schema = new SchemaBuilder(connection);
  }

  /**
   * Run the pending migrations
   */
  async run(options: MigrationOptions = {}): Promise<string[]> {
    const ran: string[] = [];

    // Ensure the migrations repository exists
    await this.repository.createRepository();

    const files = await this.getMigrationFiles();
    const ranMigrations = await this.repository.getRan();

    const pending = files.filter((file) => !ranMigrations.includes(file));

    if (pending.length === 0) {
      return [];
    }

    const batch = await this.repository.getNextBatchNumber();

    for (const file of pending) {
      await this.runUp(file, batch, options.pretend || false);
      ran.push(file);
    }

    return ran;
  }

  /**
   * Run a single migration up
   */
  protected async runUp(file: string, batch: number, pretend: boolean): Promise<void> {
    const migration = await this.resolveMigration(file);

    if (pretend) {
      console.log(`Would run: ${file}`);
      return;
    }

    await migration.up(this.schema);
    await this.repository.log(file, batch);
  }

  /**
   * Rollback the last migration batch
   */
  async rollback(options: MigrationOptions = {}): Promise<string[]> {
    const rolledBack: string[] = [];

    const migrations = await this.getMigrationsForRollback(options);

    if (migrations.length === 0) {
      return [];
    }

    for (const migration of migrations) {
      await this.runDown(migration.migration, options.pretend || false);
      rolledBack.push(migration.migration);
    }

    return rolledBack;
  }

  /**
   * Run a single migration down
   */
  protected async runDown(file: string, pretend: boolean): Promise<void> {
    const migration = await this.resolveMigration(file);

    if (pretend) {
      console.log(`Would rollback: ${file}`);
      return;
    }

    await migration.down(this.schema);
    await this.repository.delete({ migration: file, batch: 0 });
  }

  /**
   * Reset all migrations
   */
  async reset(): Promise<string[]> {
    const rolledBack: string[] = [];

    const migrations = await this.repository.getMigrations();

    if (migrations.length === 0) {
      return [];
    }

    // Reverse the order for rollback
    migrations.reverse();

    for (const migration of migrations) {
      await this.runDown(migration.migration, false);
      rolledBack.push(migration.migration);
    }

    return rolledBack;
  }

  /**
   * Refresh the database (reset and re-run all migrations)
   */
  async refresh(): Promise<{ rolledBack: string[]; ran: string[] }> {
    const rolledBack = await this.reset();
    const ran = await this.run();

    return { rolledBack, ran };
  }

  /**
   * Get migrations for rollback
   */
  protected async getMigrationsForRollback(options: MigrationOptions): Promise<any[]> {
    if (options.step && options.step > 0) {
      return await this.repository.getMigrations(options.step);
    }

    return await this.repository.getLast();
  }

  /**
   * Resolve a migration instance from a file
   */
  protected async resolveMigration(file: string): Promise<Migration> {
    const migrationPath = await this.findMigrationFile(file);

    if (!migrationPath) {
      throw new Error(`Migration file not found: ${file}`);
    }

    // Import the migration file
    const migrationModule = await import(migrationPath);

    // Get the default export or the first class export
    const MigrationClass = migrationModule.default || Object.values(migrationModule)[0];

    if (!MigrationClass) {
      throw new Error(`No migration class found in: ${file}`);
    }

    return new (MigrationClass as any)();
  }

  /**
   * Find a migration file in the paths
   */
  protected async findMigrationFile(file: string): Promise<string | null> {
    for (const searchPath of this.paths) {
      const fullPath = path.join(searchPath, file);

      // Try with .ts extension
      if (fs.existsSync(fullPath + '.ts')) {
        return fullPath + '.ts';
      }

      // Try with .js extension
      if (fs.existsSync(fullPath + '.js')) {
        return fullPath + '.js';
      }

      // Try without extension
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }

    return null;
  }

  /**
   * Get all migration files
   */
  async getMigrationFiles(): Promise<string[]> {
    const files: string[] = [];

    for (const searchPath of this.paths) {
      if (!fs.existsSync(searchPath)) {
        continue;
      }

      const dirFiles = fs.readdirSync(searchPath);

      for (const file of dirFiles) {
        if (file.match(/\.(ts|js)$/)) {
          files.push(file.replace(/\.(ts|js)$/, ''));
        }
      }
    }

    // Remove duplicates and sort
    return Array.from(new Set(files)).sort();
  }

  /**
   * Get the ran migrations
   */
  async getRan(): Promise<string[]> {
    return await this.repository.getRan();
  }

  /**
   * Get migrations with their batch numbers
   */
  async getMigrationBatches(): Promise<Record<string, number>> {
    return await this.repository.getMigrationBatches();
  }

  /**
   * Get the migration repository
   */
  getRepository(): MigrationRepository {
    return this.repository;
  }

  /**
   * Set the migration paths
   */
  setPaths(paths: string[]): void {
    this.paths = paths;
  }

  /**
   * Get the migration paths
   */
  getPaths(): string[] {
    return this.paths;
  }
}
