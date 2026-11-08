/**
 * Migrator
 *
 * Handles running and rolling back migrations
 */

import * as fs from 'fs';
import * as path from 'path';
import { Connection } from '@/Database/Connection';
import { Migration } from './Migration';
import { MigrationRepository } from './MigrationRepository';
import { SchemaBuilder } from './SchemaBuilder';

export interface MigrationOptions {
  /**
   * When rolling back, how many migrations to undo.
   *
   * When running, a truthy value puts each migration in its own batch, so a
   * single migration can be rolled back later instead of the whole run.
   *
   * Forcing past a production check and seeding are the commands' business, not
   * the migrator's, so they are not options here.
   */
  step?: number | boolean;
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

    // With `--step` every migration becomes its own batch, which is what makes
    // rolling back a single migration possible later on.
    const oneBatchEach = Boolean(options.step);

    let batch = await this.repository.getNextBatchNumber();

    for (const file of pending) {
      if (oneBatchEach) {
        batch = await this.repository.getNextBatchNumber();
      }

      await this.runUp(file, batch, options.pretend || false);
      ran.push(file);
    }

    return ran;
  }

  /**
   * Run a single migration up
   *
   * On a driver that keeps DDL inside a transaction, the migration and the
   * record of it are written together: if the migration fails partway, neither
   * the schema change nor its log entry is left behind.
   */
  protected async runUp(file: string, batch: number, pretend: boolean): Promise<void> {
    const migration = await this.resolveMigration(file);

    if (pretend) {
      console.log(`Would run: ${file}`);
      return;
    }

    await this.withSchemaTransaction(async () => {
      await migration.up(this.schema);
      await this.repository.log(file, batch);
    });
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

    await this.withSchemaTransaction(async () => {
      await migration.down(this.schema);
      await this.repository.delete({ migration: file, batch: 0 });
    });
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
   * Drop all tables in the connected database.
   *
   * Unlike reset(), this does not rely on migration records or down() methods.
   * It queries the database's own schema catalog for every table name and
   * issues a DROP TABLE IF EXISTS for each one, giving a truly clean slate
   * regardless of whether migrations were tracked. Constraints are switched off
   * for the duration, so tables can be dropped in any order, and an already
   * empty database runs nothing at all.
   */
  async dropAllTables(): Promise<void> {
    const tables = await this.connection.getTables();

    if (tables.length === 0) {
      return;
    }

    await this.schema.withoutForeignKeyConstraints(async () => {
      for (const table of tables) {
        await this.schema.dropIfExists(table);
      }
    });
  }

  /**
   * Create the migration repository, the step `migrate:install` performs.
   */
  async createRepository(): Promise<void> {
    await this.repository.createRepository();
  }

  /**
   * Refresh the database (reset and re-run all migrations)
   *
   * Without a step count every migration is rolled back, as it always has been;
   * `--step=5` rolls back and re-runs only the last five.
   */
  async refresh(options: MigrationOptions = {}): Promise<{ rolledBack: string[]; ran: string[] }> {
    const rolledBack = this.rollbackSteps(options.step) ? await this.rollback(options) : await this.reset();
    const ran = await this.run(options);

    return { rolledBack, ran };
  }

  /**
   * Get migrations for rollback
   */
  protected async getMigrationsForRollback(options: MigrationOptions): Promise<any[]> {
    const steps = this.rollbackSteps(options.step);

    if (steps) {
      return await this.repository.getMigrations(steps);
    }

    return await this.repository.getLast();
  }

  /**
   * How many migrations a rollback should undo. A bare `--step` flag counts as
   * one; nothing given means the last batch.
   */
  protected rollbackSteps(step?: number | boolean): number | undefined {
    if (typeof step === 'number') {
      return step > 0 ? step : undefined;
    }

    return step ? 1 : undefined;
  }

  /**
   * Run schema work inside a transaction when the driver keeps DDL
   * transactional, and plainly when it commits each statement anyway.
   */
  protected async withSchemaTransaction(work: () => Promise<void>): Promise<void> {
    if (!this.schema.getGrammar().supportsSchemaTransactions()) {
      await work();
      return;
    }

    await this.connection.transaction(work);
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
