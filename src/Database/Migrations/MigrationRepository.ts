/**
 * MigrationRepository
 *
 * Manages the migrations table that tracks which migrations have been run
 */

import { Connection } from '@/Database/Connection';

export interface MigrationData {
  id?: number;
  migration: string;
  batch: number;
}

export class MigrationRepository {
  protected table: string = 'migrations';

  constructor(protected connection: Connection) {}

  /**
   * Get the migrations that have been run
   */
  async getRan(): Promise<string[]> {
    const results = await this.connection.table(this.table).orderBy('batch', 'asc').orderBy('migration', 'asc').get();

    return results.map((row: any) => row.migration);
  }

  /**
   * Get the list of migrations
   */
  async getMigrations(steps?: number): Promise<MigrationData[]> {
    const query = this.connection.table(this.table).orderBy('batch', 'desc').orderBy('migration', 'desc');

    if (steps !== undefined && steps > 0) {
      query.limit(steps);
    }

    return await query.get();
  }

  /**
   * Get the last migration batch
   */
  async getLast(): Promise<MigrationData[]> {
    const batch = await this.getLastBatchNumber();

    if (batch === 0) {
      return [];
    }

    return await this.connection.table(this.table).where('batch', batch).orderBy('migration', 'desc').get();
  }

  /**
   * Get the migrations for a batch
   */
  async getMigrationBatches(): Promise<Record<string, number>> {
    const results = await this.connection.table(this.table).orderBy('batch', 'asc').orderBy('migration', 'asc').get();

    const batches: Record<string, number> = {};
    results.forEach((row: any) => {
      batches[row.migration] = row.batch;
    });

    return batches;
  }

  /**
   * Log that a migration was run
   */
  async log(file: string, batch: number): Promise<void> {
    await this.connection.table(this.table).insert({
      migration: file,
      batch,
    });
  }

  /**
   * Remove a migration from the log
   */
  async delete(migration: MigrationData): Promise<void> {
    await this.connection.table(this.table).where('migration', migration.migration).delete();
  }

  /**
   * Get the next migration batch number
   */
  async getNextBatchNumber(): Promise<number> {
    return (await this.getLastBatchNumber()) + 1;
  }

  /**
   * Get the last migration batch number
   */
  async getLastBatchNumber(): Promise<number> {
    const result = await this.connection.table(this.table).max('batch');

    return result !== null ? Number(result) : 0;
  }

  /**
   * Create the migration repository table
   */
  async createRepository(): Promise<void> {
    const schema = this.connection.getAdapter();

    await this.connection.query(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration VARCHAR(255) NOT NULL,
        batch INTEGER NOT NULL
      )
    `);
  }

  /**
   * Determine if the migration repository exists
   */
  async repositoryExists(): Promise<boolean> {
    try {
      await this.connection.table(this.table).limit(1).get();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Delete the migration repository
   */
  async deleteRepository(): Promise<void> {
    await this.connection.query(`DROP TABLE IF EXISTS ${this.table}`);
  }

  /**
   * Set the information source to gather data
   */
  setSource(name: string): void {
    // Reserved for future use with different connections
  }
}
