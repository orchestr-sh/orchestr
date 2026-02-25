/**
 * DrizzleAdapter
 *
 * Database adapter implementation using Drizzle ORM
 */

import { DatabaseAdapter, DatabaseConfig, QueryResult } from '@/Database/Contracts/DatabaseAdapter';

export class DrizzleAdapter implements DatabaseAdapter {
  protected client: any;
  protected rawClient: any;
  protected connected: boolean = false;
  protected inTransaction: boolean = false;
  protected transactionClient: any;

  constructor(protected config: DatabaseConfig) {}

  /**
   * Connect to the database
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    try {
      // Dynamically import the appropriate Drizzle driver
      switch (this.config.driver) {
        case 'postgres':
          await this.connectPostgres();
          break;
        case 'mysql':
        case 'mysql2':
          await this.connectMySQL();
          break;
        case 'better-sqlite3':
        case 'sqlite':
          await this.connectSQLite();
          break;
        default:
          throw new Error(`Unsupported database driver: ${this.config.driver}`);
      }

      this.connected = true;
    } catch (error: any) {
      throw new Error(`Failed to connect to database: ${error?.message || error}`, { cause: error });
    }
  }

  /**
   * Connect to PostgreSQL
   */
  protected async connectPostgres(): Promise<void> {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const postgres = await import('postgres');

    const rawClient = postgres.default({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      username: this.config.username,
      password: this.config.password,
      max: this.config.poolMax || 10,
    });

    this.rawClient = rawClient;
    this.client = drizzle(rawClient);
  }

  /**
   * Connect to MySQL
   */
  protected async connectMySQL(): Promise<void> {
    const { drizzle } = await import('drizzle-orm/mysql2');
    const mysql = await import('mysql2/promise');

    const rawClient = await mysql.createPool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
      connectionLimit: this.config.poolMax || 10,
    });

    this.rawClient = rawClient;
    this.client = drizzle(rawClient);
  }

  /**
   * Connect to SQLite
   */
  protected async connectSQLite(): Promise<void> {
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const Database = await import('better-sqlite3');

    const rawClient = new Database.default(this.config.database);
    this.rawClient = rawClient;
    this.client = drizzle(rawClient);
  }

  /**
   * Disconnect from the database
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    // Close the raw client connection if possible
    if (this.rawClient) {
      switch (this.config.driver) {
        case 'postgres':
          await this.rawClient.end?.();
          break;
        case 'mysql':
        case 'mysql2':
          await this.rawClient.end?.();
          break;
        case 'better-sqlite3':
        case 'sqlite':
          this.rawClient.close?.();
          break;
      }
    }

    this.connected = false;
    this.client = null;
    this.rawClient = null;
  }

  /**
   * Execute a raw SQL query
   */
  async query<T = any>(sql: string, bindings: any[] = []): Promise<QueryResult<T>> {
    this.ensureConnected();

    try {
      const client = this.inTransaction ? this.transactionClient : this.rawClient;
      const boundSql = this.bindParameters(sql, bindings);

      let result: any;

      // Execute based on driver type
      switch (this.config.driver) {
        case 'postgres':
          result = await client.unsafe(boundSql);
          break;
        case 'mysql':
        case 'mysql2': {
          const [rows] = await client.execute(boundSql);
          result = rows;
          break;
        }
        case 'better-sqlite3':
        case 'sqlite':
          result = client.prepare(boundSql).all();
          break;
        default:
          throw new Error(`Unsupported database driver: ${this.config.driver}`);
      }

      return {
        rows: Array.isArray(result) ? result : result.rows || [],
        rowCount: Array.isArray(result) ? result.length : result.rowCount || 0,
      };
    } catch (error: any) {
      throw new Error(`Query failed: ${error?.message || error}\nSQL: ${sql}`, { cause: error });
    }
  }

  /**
   * Execute a SELECT query
   */
  async select<T = any>(sql: string, bindings: any[] = []): Promise<T[]> {
    const result = await this.query<T>(sql, bindings);
    return result.rows;
  }

  /**
   * Execute an INSERT query
   */
  async insert(sql: string, bindings: any[] = []): Promise<any> {
    this.ensureConnected();

    try {
      const client = this.inTransaction ? this.transactionClient : this.rawClient;
      const boundSql = this.bindParameters(sql, bindings);

      let result: any;

      // Execute based on driver type
      switch (this.config.driver) {
        case 'postgres':
          result = await client.unsafe(boundSql);
          break;
        case 'mysql':
        case 'mysql2':
          [result] = await client.execute(boundSql);
          break;
        case 'better-sqlite3':
        case 'sqlite':
          result = client.prepare(boundSql).run();
          break;
        default:
          throw new Error(`Unsupported database driver: ${this.config.driver}`);
      }

      // Return the inserted ID
      return result.insertId || result.lastInsertRowid || result.rows?.[0]?.id;
    } catch (error: any) {
      throw new Error(`Insert failed: ${error?.message || error}\nSQL: ${sql}`, { cause: error });
    }
  }

  /**
   * Execute an UPDATE query
   */
  async update(sql: string, bindings: any[] = []): Promise<number> {
    const result = await this.query(sql, bindings);
    return result.rowCount;
  }

  /**
   * Execute a DELETE query
   */
  async delete(sql: string, bindings: any[] = []): Promise<number> {
    const result = await this.query(sql, bindings);
    return result.rowCount;
  }

  /**
   * Begin a transaction
   */
  async beginTransaction(): Promise<void> {
    this.ensureConnected();

    if (this.inTransaction) {
      throw new Error('Transaction already in progress');
    }

    this.inTransaction = true;

    // For now, we'll use simple BEGIN/COMMIT/ROLLBACK
    // In a more sophisticated implementation, we'd use Drizzle's transaction API
    await this.query('BEGIN');
  }

  /**
   * Commit a transaction
   */
  async commit(): Promise<void> {
    if (!this.inTransaction) {
      throw new Error('No transaction in progress');
    }

    await this.query('COMMIT');
    this.inTransaction = false;
    this.transactionClient = null;
  }

  /**
   * Rollback a transaction
   */
  async rollback(): Promise<void> {
    if (!this.inTransaction) {
      throw new Error('No transaction in progress');
    }

    await this.query('ROLLBACK');
    this.inTransaction = false;
    this.transactionClient = null;
  }

  /**
   * Execute a callback within a transaction
   */
  async transaction<T>(callback: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
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
   * Check if adapter is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the underlying driver instance
   */
  getDriver(): any {
    return this.client;
  }

  /**
   * Get table information
   */
  async getTableInfo(tableName: string): Promise<any> {
    this.ensureConnected();

    // Implementation varies by driver
    switch (this.config.driver) {
      case 'postgres':
        return this.getPostgresTableInfo(tableName);
      case 'mysql':
      case 'mysql2':
        return this.getMySQLTableInfo(tableName);
      case 'better-sqlite3':
      case 'sqlite':
        return this.getSQLiteTableInfo(tableName);
      default:
        throw new Error('Table info not supported for this driver');
    }
  }

  /**
   * Get PostgreSQL table info
   */
  protected async getPostgresTableInfo(tableName: string): Promise<any> {
    const sql = `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = ?
      ORDER BY ordinal_position
    `;
    return this.select(sql, [tableName]);
  }

  /**
   * Get MySQL table info
   */
  protected async getMySQLTableInfo(tableName: string): Promise<any> {
    const sql = `DESCRIBE ${tableName}`;
    return this.select(sql);
  }

  /**
   * Get SQLite table info
   */
  protected async getSQLiteTableInfo(tableName: string): Promise<any> {
    const sql = `PRAGMA table_info(${tableName})`;
    return this.select(sql);
  }

  /**
   * Get all table names
   */
  async getTables(): Promise<string[]> {
    this.ensureConnected();

    switch (this.config.driver) {
      case 'postgres':
        return this.getPostgresTables();
      case 'mysql':
      case 'mysql2':
        return this.getMySQLTables();
      case 'better-sqlite3':
      case 'sqlite':
        return this.getSQLiteTables();
      default:
        throw new Error('Get tables not supported for this driver');
    }
  }

  /**
   * Get PostgreSQL tables
   */
  protected async getPostgresTables(): Promise<string[]> {
    const sql = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    `;
    const result = await this.select<any>(sql);
    return result.map((row) => row.table_name);
  }

  /**
   * Get MySQL tables
   */
  protected async getMySQLTables(): Promise<string[]> {
    const sql = 'SHOW TABLES';
    const result = await this.select<any>(sql);
    return result.map((row) => Object.values(row)[0] as string);
  }

  /**
   * Get SQLite tables
   */
  protected async getSQLiteTables(): Promise<string[]> {
    const sql = `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    `;
    const result = await this.select<any>(sql);
    return result.map((row) => row.name);
  }

  /**
   * Bind parameters to SQL query
   */
  protected bindParameters(sql: string, bindings: any[] = []): string {
    if (bindings.length === 0) {
      return sql;
    }

    // Replace ? placeholders with actual values
    // Note: This is a simple implementation. In production, use parameterized queries
    let index = 0;
    return sql.replace(/\?/g, () => {
      const value = bindings[index++];

      if (value === null || value === undefined) {
        return 'NULL';
      }

      if (typeof value === 'string') {
        return `'${value.replace(/'/g, "''")}'`;
      }

      if (typeof value === 'boolean') {
        return value ? '1' : '0';
      }

      if (value instanceof Date) {
        return `'${value.toISOString()}'`;
      }

      return String(value);
    });
  }

  /**
   * Ensure the adapter is connected
   */
  protected ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Database not connected. Call connect() first.');
    }
  }
}
