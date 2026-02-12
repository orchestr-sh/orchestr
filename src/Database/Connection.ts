/**
 * Connection Class
 *
 * Represents a database connection
 */

import { DatabaseAdapter, DatabaseConfig } from './Contracts/DatabaseAdapter';
import { Builder } from './Query/Builder';

export class Connection {
  protected queryLog: Array<{ query: string; bindings: any[]; time: number }> = [];
  protected loggingEnabled: boolean = false;

  constructor(
    protected adapter: DatabaseAdapter,
    protected config: DatabaseConfig
  ) {}

  /**
   * Get a query builder instance
   */
  table(tableName: string): Builder {
    return new Builder(this.adapter).from(tableName);
  }

  /**
   * Execute a raw SQL query
   */
  async query(sql: string, bindings: any[] = []): Promise<any> {
    return this.runQueryWithLogging(sql, bindings, () => this.adapter.query(sql, bindings));
  }

  /**
   * Execute a SELECT query
   */
  async select(sql: string, bindings: any[] = []): Promise<any[]> {
    return this.runQueryWithLogging(sql, bindings, () => this.adapter.select(sql, bindings));
  }

  /**
   * Execute an INSERT query
   */
  async insert(sql: string, bindings: any[] = []): Promise<any> {
    return this.runQueryWithLogging(sql, bindings, () => this.adapter.insert(sql, bindings));
  }

  /**
   * Execute an UPDATE query
   */
  async update(sql: string, bindings: any[] = []): Promise<number> {
    return this.runQueryWithLogging(sql, bindings, () => this.adapter.update(sql, bindings));
  }

  /**
   * Execute a DELETE query
   */
  async delete(sql: string, bindings: any[] = []): Promise<number> {
    return this.runQueryWithLogging(sql, bindings, () => this.adapter.delete(sql, bindings));
  }

  /**
   * Begin a transaction
   */
  async beginTransaction(): Promise<void> {
    await this.adapter.beginTransaction();
  }

  /**
   * Commit a transaction
   */
  async commit(): Promise<void> {
    await this.adapter.commit();
  }

  /**
   * Rollback a transaction
   */
  async rollback(): Promise<void> {
    await this.adapter.rollback();
  }

  /**
   * Execute a callback within a transaction
   */
  async transaction<T>(callback: (connection: Connection) => Promise<T>): Promise<T> {
    await this.beginTransaction();

    try {
      const result = await callback(this);
      await this.commit();
      return result;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }

  /**
   * Connect to the database
   */
  async connect(): Promise<void> {
    await this.adapter.connect();
  }

  /**
   * Disconnect from the database
   */
  async disconnect(): Promise<void> {
    await this.adapter.disconnect();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.adapter.isConnected();
  }

  /**
   * Get the underlying adapter
   */
  getAdapter(): DatabaseAdapter {
    return this.adapter;
  }

  /**
   * Get the configuration
   */
  getConfig(): DatabaseConfig {
    return this.config;
  }

  /**
   * Enable query logging
   */
  enableQueryLog(): void {
    this.loggingEnabled = true;
  }

  /**
   * Disable query logging
   */
  disableQueryLog(): void {
    this.loggingEnabled = false;
  }

  /**
   * Get the query log
   */
  getQueryLog(): Array<{ query: string; bindings: any[]; time: number }> {
    return this.queryLog;
  }

  /**
   * Clear the query log
   */
  flushQueryLog(): void {
    this.queryLog = [];
  }

  /**
   * Run a query with logging
   */
  protected async runQueryWithLogging<T>(query: string, bindings: any[], callback: () => Promise<T>): Promise<T> {
    if (!this.loggingEnabled) {
      return callback();
    }

    const start = Date.now();

    try {
      const result = await callback();
      const time = Date.now() - start;

      this.queryLog.push({ query, bindings, time });

      return result;
    } catch (error) {
      const time = Date.now() - start;
      this.queryLog.push({ query, bindings, time });
      throw error;
    }
  }
}
