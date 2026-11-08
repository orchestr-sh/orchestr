/**
 * Connection Class
 *
 * Represents a database connection
 */

import { DatabaseAdapter, DatabaseConfig } from './Contracts/DatabaseAdapter';
import { Builder } from './Query/Builder';
import { grammarForDriver, QueryGrammar } from './Query/Grammars';

/**
 * Driver error codes that signal a deadlock or a lock-wait timeout and are
 * therefore safe to retry: the rolled-back transaction left no partial state,
 * so re-running the callback has a chance of succeeding.
 */
const DEADLOCK_ERROR_CODES = new Set([
  '40001', // postgres: serialization failure
  '40P01', // postgres: deadlock detected
  'ER_LOCK_DEADLOCK', // mysql: deadlock on lock
  'ER_LOCK_WAIT_TIMEOUT', // mysql: lock wait timeout
  'SQLITE_BUSY', // sqlite: database file is locked
  'SQLITE_LOCKED', // sqlite: table is locked
]);

/**
 * Numeric driver error codes (mysql2 `errno`) for the same retryable failures.
 */
const DEADLOCK_ERROR_ERRNOS = new Set([
  1205, // mysql: lock wait timeout
  1213, // mysql: deadlock on lock
]);

export class Connection {
  protected queryLog: Array<{ query: string; bindings: any[]; time: number }> = [];
  protected loggingEnabled: boolean = false;
  protected grammar?: QueryGrammar;
  /**
   * Pause between deadlock retries of `transaction()`, mirroring Laravel's
   * 50ms `deadlockRetryInterval`.
   */
  protected deadlockRetryDelayMs: number = 50;

  constructor(
    protected adapter: DatabaseAdapter,
    protected config: DatabaseConfig
  ) {}

  /**
   * Get a query builder instance
   */
  table(tableName: string): Builder {
    return new Builder(this.adapter, this.getGrammar()).from(tableName);
  }

  /**
   * Get the grammar that compiles this connection's queries.
   *
   * It is resolved from the configured driver the first time it is needed, so a
   * connection can be created for a driver no grammar exists for as long as no
   * query is compiled.
   */
  getGrammar(): QueryGrammar {
    if (!this.grammar) {
      this.grammar = grammarForDriver(this.config.driver);
    }

    return this.grammar;
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
   * Execute a callback within a transaction.
   *
   * The same connection is passed to the callback, so `db.table(...)` writes
   * and Ensemble model queries all run through the adapter's transaction
   * client. When `attempts` is greater than one the whole transaction is
   * retried, but only for deadlock/lock-timeout failures; any other error is
   * rolled back and rethrown immediately.
   */
  async transaction<T>(callback: (connection: Connection) => Promise<T>, attempts: number = 1): Promise<T> {
    const maxAttempts = Math.max(1, Math.floor(attempts));

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.runInTransaction(callback);
      } catch (error) {
        if (attempt >= maxAttempts || !Connection.isDeadlockOrLockTimeout(error)) {
          throw error;
        }

        await Connection.sleep(this.deadlockRetryDelayMs);
      }
    }
  }

  /**
   * Run one attempt of `transaction()`: begin, hand this same connection to
   * the callback, then commit or roll back.
   */
  protected async runInTransaction<T>(callback: (connection: Connection) => Promise<T>): Promise<T> {
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
   * Detect the deadlock/lock-timeout errors that `transaction()` retries on.
   *
   * The adapter wraps driver failures with the original error as `cause`, so
   * the whole cause chain is inspected for the driver's error code.
   */
  protected static isDeadlockOrLockTimeout(error: unknown): boolean {
    const seen = new Set<unknown>();
    let current: any = error;

    while (current !== null && current !== undefined && !seen.has(current)) {
      seen.add(current);

      if (typeof current.code === 'string' && DEADLOCK_ERROR_CODES.has(current.code)) {
        return true;
      }

      if (typeof current.code === 'number' && DEADLOCK_ERROR_ERRNOS.has(current.code)) {
        return true;
      }

      if (typeof current.errno === 'number' && DEADLOCK_ERROR_ERRNOS.has(current.errno)) {
        return true;
      }

      current = current.cause;
    }

    return false;
  }

  /**
   * Wait for the given number of milliseconds between deadlock retries.
   */
  protected static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
   * Get all table names in the connected database
   */
  async getTables(): Promise<string[]> {
    return this.adapter.getTables();
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
