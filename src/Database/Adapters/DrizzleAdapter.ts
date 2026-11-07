/**
 * DrizzleAdapter
 *
 * Database adapter implementation using Drizzle ORM
 */

import { DatabaseAdapter, DatabaseConfig, QueryResult } from '@/Database/Contracts/DatabaseAdapter';

/**
 * How a statement should be executed and what should be reported back.
 *
 * - `all`: read every row produced by the statement
 * - `get`: read only the first row produced by the statement
 * - `run`: execute the statement and report affected rows / the inserted id
 */
type ExecutionMode = 'all' | 'run' | 'get';

/**
 * Normalized result of a single execution.
 *
 * `rows`/`rowCount` are the `QueryResult` callers see; `insertId` is extra
 * information the adapter needs for `insert()` and is never exposed as a
 * `QueryResult` field.
 */
interface ExecutedResult<T = any> {
  rows: T[];
  rowCount: number;
  insertId?: any;
}

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
    const result = await this.execute<T>(sql, bindings, 'all');

    return { rows: result.rows, rowCount: result.rowCount };
  }

  /**
   * Execute a SELECT query
   */
  async select<T = any>(sql: string, bindings: any[] = []): Promise<T[]> {
    const result = await this.execute<T>(sql, bindings, 'all');
    return result.rows;
  }

  /**
   * Execute an INSERT query
   */
  async insert(sql: string, bindings: any[] = []): Promise<any> {
    const result = await this.execute(sql, bindings, 'run');
    return result.insertId;
  }

  /**
   * Execute an UPDATE query
   */
  async update(sql: string, bindings: any[] = []): Promise<number> {
    const result = await this.execute(sql, bindings, 'run');
    return result.rowCount;
  }

  /**
   * Execute a DELETE query
   */
  async delete(sql: string, bindings: any[] = []): Promise<number> {
    const result = await this.execute(sql, bindings, 'run');
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
   * Execute a statement with its bindings passed natively to the driver.
   *
   * This is the single execution path behind `query()`, `select()`, `insert()`,
   * `update()` and `delete()`. Bindings are never written into the SQL text: the
   * driver receives the statement and the values separately, so quotes,
   * semicolons, comments and `?` characters inside a value stay data.
   */
  private async execute<T = any>(sql: string, bindings: any[], mode: ExecutionMode): Promise<ExecutedResult<T>> {
    this.ensureConnected();

    // The driver instance to talk to: the transaction client when one is active,
    // otherwise the pooled connection.
    const client = this.transactionClient ?? this.rawClient;

    try {
      const values = this.normalizeBindings(bindings);

      switch (this.config.driver) {
        case 'postgres':
          return await this.executePostgres<T>(client, sql, values, mode);
        case 'mysql':
        case 'mysql2':
          return await this.executeMysql<T>(client, sql, values, mode);
        case 'better-sqlite3':
        case 'sqlite':
          return this.executeSqlite<T>(client, sql, values, mode);
        default:
          throw new Error(`Unsupported database driver: ${this.config.driver}`);
      }
    } catch (error: any) {
      throw new Error(`Query failed: ${error?.message || error}\nSQL: ${sql}`, { cause: error });
    }
  }

  /**
   * Execute through better-sqlite3: positional `?` parameters bound natively.
   */
  private executeSqlite<T = any>(client: any, sql: string, values: any[], mode: ExecutionMode): ExecutedResult<T> {
    const statement = client.prepare(sql);

    // Statements that produce no rows (DDL, DML, BEGIN/COMMIT) must be run(),
    // otherwise better-sqlite3 throws when asked for rows that do not exist.
    if (mode === 'run' || (mode === 'all' && statement.reader === false)) {
      const info = statement.run(...values);
      return { rows: [], rowCount: Number(info?.changes ?? 0), insertId: info?.lastInsertRowid };
    }

    if (mode === 'get') {
      const row = statement.get(...values);
      return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
    }

    const rows: T[] = statement.all(...values);
    return { rows, rowCount: rows.length };
  }

  /**
   * Execute through postgres.js: values are sent as real query parameters.
   */
  private async executePostgres<T = any>(
    client: any,
    sql: string,
    values: any[],
    mode: ExecutionMode
  ): Promise<ExecutedResult<T>> {
    const query = values.length > 0 ? this.toPostgresPlaceholders(sql, values.length) : sql;
    const result: any = await client.unsafe(query, values);

    const rows: T[] = Array.isArray(result) ? result : result?.rows || [];

    if (mode === 'run') {
      // postgres.js reports affected rows on the command tag, not in `rows`.
      const affected = Number.isFinite(result?.count) ? Number(result.count) : rows.length;
      return { rows, rowCount: affected, insertId: (rows[0] as any)?.id };
    }

    if (mode === 'get') {
      return { rows: rows.slice(0, 1), rowCount: Math.min(rows.length, 1) };
    }

    return { rows, rowCount: rows.length };
  }

  /**
   * Execute through mysql2: positional `?` parameters bound natively.
   */
  private async executeMysql<T = any>(
    client: any,
    sql: string,
    values: any[],
    mode: ExecutionMode
  ): Promise<ExecutedResult<T>> {
    const [result] = await client.execute(sql, values);

    if (Array.isArray(result)) {
      const rows: T[] = result;

      if (mode === 'run') {
        return { rows, rowCount: rows.length, insertId: (rows[0] as any)?.id };
      }

      if (mode === 'get') {
        return { rows: rows.slice(0, 1), rowCount: Math.min(rows.length, 1) };
      }

      return { rows, rowCount: rows.length };
    }

    // DML/DDL statements give a result header instead of rows.
    return {
      rows: [],
      rowCount: Number(result?.affectedRows ?? 0),
      insertId: result?.insertId,
    };
  }

  /**
   * Normalize bindings before handing them to the driver.
   *
   * `undefined` becomes `null`, dates become ISO strings, and booleans become
   * 1/0 only for the drivers that cannot bind a boolean natively. Anything the
   * driver cannot bind (objects, arrays, functions, symbols) fails loudly rather
   * than being silently stringified into the SQL text.
   */
  private normalizeBindings(bindings: any[]): any[] {
    return bindings.map((value) => this.normalizeBinding(value));
  }

  /**
   * Normalize a single binding value.
   */
  private normalizeBinding(value: any): any {
    if (value === undefined || value === null) {
      return null;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    switch (typeof value) {
      case 'string':
      case 'number':
      case 'bigint':
        return value;
      case 'boolean':
        return this.bindsBooleansNatively() ? value : Number(value);
      case 'object':
        if (this.isBinary(value)) {
          return value;
        }
        throw this.unsupportedBinding(value);
      default:
        throw this.unsupportedBinding(value);
    }
  }

  /**
   * Whether the current driver can bind a JS boolean as a native parameter.
   *
   * better-sqlite3 only binds numbers, strings, bigints, buffers and null, so
   * booleans are converted to 1/0 there. postgres.js and mysql2 both send
   * booleans natively.
   */
  private bindsBooleansNatively(): boolean {
    return this.config.driver !== 'better-sqlite3' && this.config.driver !== 'sqlite';
  }

  /**
   * Binary values are bindable by every supported driver.
   */
  private isBinary(value: any): boolean {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
      return true;
    }

    return ArrayBuffer.isView(value) && !(value instanceof DataView);
  }

  /**
   * Error for values the driver cannot bind as a parameter.
   */
  private unsupportedBinding(value: any): Error {
    const kind = Array.isArray(value) ? 'array' : typeof value === 'object' ? 'object' : typeof value;

    return new TypeError(
      `Cannot bind a value of type "${kind}" as a query parameter for the "${this.config.driver}" driver. ` +
        'Serialize the value explicitly before passing it as a binding (for example: JSON.stringify()).'
    );
  }

  /**
   * Rewrite `?` placeholders into the `$n` form postgres.js expects.
   *
   * Only placeholder tokens are rewritten: quoted strings, quoted identifiers
   * and comments are copied through verbatim, so a literal `?` inside the SQL
   * text never shifts the binding order. Values are never touched here — they
   * stay in the parameter array sent alongside the statement.
   */
  private toPostgresPlaceholders(sql: string, expected: number): string {
    let out = '';
    let index = 0;
    let placeholders = 0;

    while (index < sql.length) {
      const char = sql[index];

      if (char === "'" || char === '"' || char === '`') {
        const end = this.endOfQuoted(sql, index, char);
        out += sql.slice(index, end);
        index = end;
        continue;
      }

      if (char === '-' && sql[index + 1] === '-') {
        const end = sql.indexOf('\n', index);
        const stop = end === -1 ? sql.length : end;
        out += sql.slice(index, stop);
        index = stop;
        continue;
      }

      if (char === '/' && sql[index + 1] === '*') {
        const end = sql.indexOf('*/', index + 2);
        const stop = end === -1 ? sql.length : end + 2;
        out += sql.slice(index, stop);
        index = stop;
        continue;
      }

      if (char === '?') {
        placeholders += 1;
        out += `$${placeholders}`;
        index += 1;
        continue;
      }

      out += char;
      index += 1;
    }

    if (placeholders !== expected) {
      throw new Error(`Cannot bind ${expected} parameter(s) against ${placeholders} placeholder(s) in SQL: ${sql}`);
    }

    return out;
  }

  /**
   * End index (exclusive) of a quoted literal/identifier starting at `start`.
   *
   * Doubled quotes (`''`, `""`) are escapes and stay inside the quoted region.
   */
  private endOfQuoted(sql: string, start: number, quote: string): number {
    let index = start + 1;

    while (index < sql.length) {
      if (sql[index] === quote) {
        if (sql[index + 1] === quote) {
          index += 2;
          continue;
        }
        return index + 1;
      }
      index += 1;
    }

    return sql.length;
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
