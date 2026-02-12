/**
 * SchemaBuilder
 *
 * Builds and executes schema migrations with support for multiple database drivers
 */

import { Schema } from '../Contracts/Schema';
import { Connection } from '../Connection';
import { Blueprint } from './Blueprint';
import { ColumnDefinition } from './ColumnDefinition';
import { ForeignKeyDefinition } from './ForeignKeyDefinition';

export class SchemaBuilder implements Schema {
  protected driver: string;

  constructor(protected connection: Connection) {
    this.driver = connection.getConfig().driver;
  }

  /**
   * Create a new table
   */
  async create(tableName: string, callback: (table: Blueprint) => void): Promise<void> {
    const blueprint = new Blueprint(tableName);
    blueprint.isCreate = true;
    callback(blueprint);

    const sql = this.compileCreate(blueprint);
    await this.connection.query(sql);

    // Create indexes
    for (const index of blueprint.indexes) {
      const indexSql = this.compileIndex(tableName, index);
      if (indexSql) {
        await this.connection.query(indexSql);
      }
    }

    // Create foreign keys
    for (const fk of blueprint.foreignKeys) {
      const fkSql = this.compileForeignKey(tableName, fk);
      if (fkSql) {
        await this.connection.query(fkSql);
      }
    }
  }

  /**
   * Drop a table
   */
  async drop(tableName: string): Promise<void> {
    const sql = `DROP TABLE ${this.wrapTable(tableName)}`;
    await this.connection.query(sql);
  }

  /**
   * Drop a table if it exists
   */
  async dropIfExists(tableName: string): Promise<void> {
    const sql = `DROP TABLE IF EXISTS ${this.wrapTable(tableName)}`;
    await this.connection.query(sql);
  }

  /**
   * Rename a table
   */
  async rename(from: string, to: string): Promise<void> {
    const sql = this.compileRename(from, to);
    await this.connection.query(sql);
  }

  /**
   * Determine if a table exists
   */
  async hasTable(tableName: string): Promise<boolean> {
    const sql = this.compileHasTable(tableName);
    const results = await this.connection.select(sql);
    return results.length > 0;
  }

  /**
   * Determine if a column exists on a table
   */
  async hasColumn(tableName: string, columnName: string): Promise<boolean> {
    const sql = this.compileHasColumn(tableName, columnName);
    const results = await this.connection.select(sql);
    return results.length > 0;
  }

  /**
   * Modify an existing table
   */
  async table(tableName: string, callback: (table: Blueprint) => void): Promise<void> {
    const blueprint = new Blueprint(tableName);
    blueprint.isCreate = false;
    callback(blueprint);

    // Add new columns
    for (const column of blueprint.columns) {
      const sql = this.compileAddColumn(tableName, column);
      await this.connection.query(sql);
    }

    // Execute commands (drop, rename, etc.)
    for (const command of blueprint.commands) {
      const sql = this.compileCommand(tableName, command);
      if (sql) {
        await this.connection.query(sql);
      }
    }

    // Create indexes
    for (const index of blueprint.indexes) {
      const indexSql = this.compileIndex(tableName, index);
      if (indexSql) {
        await this.connection.query(indexSql);
      }
    }

    // Create foreign keys
    for (const fk of blueprint.foreignKeys) {
      const fkSql = this.compileForeignKey(tableName, fk);
      if (fkSql) {
        await this.connection.query(fkSql);
      }
    }
  }

  /**
   * Compile CREATE TABLE statement
   */
  protected compileCreate(blueprint: Blueprint): string {
    const columns = blueprint.columns.map((col) => this.compileColumnDefinition(col)).join(', ');

    let sql = `CREATE TABLE ${this.wrapTable(blueprint.table)} (${columns}`;

    // Add primary key if defined in indexes
    const primaryKey = blueprint.indexes.find((idx) => idx.type === 'primary');
    if (primaryKey) {
      sql += `, PRIMARY KEY (${primaryKey.columns.map((c) => this.wrap(c)).join(', ')})`;
    }

    sql += ')';

    return sql;
  }

  /**
   * Compile column definition
   */
  protected compileColumnDefinition(column: ColumnDefinition): string {
    let sql = this.wrap(column.name) + ' ' + this.getColumnType(column);

    if (column.isAutoIncrement) {
      sql += this.getAutoIncrementClause(column);
    }

    if (!column.isNullable && !column.isAutoIncrement) {
      sql += ' NOT NULL';
    }

    if (column.defaultValue !== undefined) {
      sql += ' DEFAULT ' + this.getDefaultValue(column.defaultValue);
    }

    return sql;
  }

  /**
   * Get column type SQL
   */
  protected getColumnType(column: ColumnDefinition): string {
    switch (this.driver) {
      case 'sqlite':
        return this.getSQLiteColumnType(column);
      case 'postgres':
      case 'postgresql':
        return this.getPostgresColumnType(column);
      case 'mysql':
        return this.getMySQLColumnType(column);
      default:
        return this.getSQLiteColumnType(column);
    }
  }

  /**
   * Get SQLite column type
   */
  protected getSQLiteColumnType(column: ColumnDefinition): string {
    switch (column.type) {
      case 'bigIncrements':
      case 'increments':
        return 'INTEGER';
      case 'bigInteger':
      case 'integer':
      case 'smallInteger':
      case 'tinyInteger':
        return 'INTEGER';
      case 'string':
      case 'uuid':
        return column.length ? `VARCHAR(${column.length})` : 'VARCHAR(255)';
      case 'text':
      case 'mediumText':
      case 'longText':
        return 'TEXT';
      case 'decimal':
      case 'float':
      case 'double':
        return 'REAL';
      case 'boolean':
        return 'INTEGER';
      case 'date':
        return 'DATE';
      case 'datetime':
      case 'timestamp':
        return 'DATETIME';
      case 'json':
      case 'jsonb':
        return 'TEXT';
      case 'binary':
        return 'BLOB';
      case 'enum':
        return 'TEXT';
      default:
        return 'TEXT';
    }
  }

  /**
   * Get PostgreSQL column type
   */
  protected getPostgresColumnType(column: ColumnDefinition): string {
    switch (column.type) {
      case 'bigIncrements':
        return 'BIGSERIAL';
      case 'increments':
        return 'SERIAL';
      case 'bigInteger':
        return 'BIGINT';
      case 'integer':
        return 'INTEGER';
      case 'smallInteger':
        return 'SMALLINT';
      case 'tinyInteger':
        return 'SMALLINT';
      case 'string':
        return column.length ? `VARCHAR(${column.length})` : 'VARCHAR(255)';
      case 'uuid':
        return 'UUID';
      case 'text':
        return 'TEXT';
      case 'mediumText':
      case 'longText':
        return 'TEXT';
      case 'decimal':
        return column.precision && column.scale ? `DECIMAL(${column.precision}, ${column.scale})` : 'DECIMAL(8, 2)';
      case 'float':
        return 'REAL';
      case 'double':
        return 'DOUBLE PRECISION';
      case 'boolean':
        return 'BOOLEAN';
      case 'date':
        return 'DATE';
      case 'datetime':
        return column.precision ? `TIMESTAMP(${column.precision})` : 'TIMESTAMP';
      case 'timestamp':
        return column.precision ? `TIMESTAMP(${column.precision})` : 'TIMESTAMP';
      case 'json':
        return 'JSON';
      case 'jsonb':
        return 'JSONB';
      case 'binary':
        return 'BYTEA';
      case 'enum':
        // PostgreSQL enums would need to be created separately, use VARCHAR for simplicity
        return 'VARCHAR(255)';
      default:
        return 'TEXT';
    }
  }

  /**
   * Get MySQL column type
   */
  protected getMySQLColumnType(column: ColumnDefinition): string {
    switch (column.type) {
      case 'bigIncrements':
        return 'BIGINT UNSIGNED AUTO_INCREMENT';
      case 'increments':
        return 'INT UNSIGNED AUTO_INCREMENT';
      case 'bigInteger':
        return column.isUnsigned ? 'BIGINT UNSIGNED' : 'BIGINT';
      case 'integer':
        return column.isUnsigned ? 'INT UNSIGNED' : 'INT';
      case 'smallInteger':
        return column.isUnsigned ? 'SMALLINT UNSIGNED' : 'SMALLINT';
      case 'tinyInteger':
        return column.isUnsigned ? 'TINYINT UNSIGNED' : 'TINYINT';
      case 'string':
        return column.length ? `VARCHAR(${column.length})` : 'VARCHAR(255)';
      case 'uuid':
        return 'CHAR(36)';
      case 'text':
        return 'TEXT';
      case 'mediumText':
        return 'MEDIUMTEXT';
      case 'longText':
        return 'LONGTEXT';
      case 'decimal':
        return column.precision && column.scale ? `DECIMAL(${column.precision}, ${column.scale})` : 'DECIMAL(8, 2)';
      case 'float':
        return column.precision && column.scale ? `FLOAT(${column.precision}, ${column.scale})` : 'FLOAT';
      case 'double':
        return column.precision && column.scale ? `DOUBLE(${column.precision}, ${column.scale})` : 'DOUBLE';
      case 'boolean':
        return 'TINYINT(1)';
      case 'date':
        return 'DATE';
      case 'datetime':
        return column.precision ? `DATETIME(${column.precision})` : 'DATETIME';
      case 'timestamp':
        return column.precision ? `TIMESTAMP(${column.precision})` : 'TIMESTAMP';
      case 'json':
        return 'JSON';
      case 'jsonb':
        return 'JSON';
      case 'binary':
        return 'BLOB';
      case 'enum':
        return column.enumValues ? `ENUM(${column.enumValues.map((v) => `'${v}'`).join(', ')})` : 'VARCHAR(255)';
      default:
        return 'TEXT';
    }
  }

  /**
   * Get auto increment clause
   */
  protected getAutoIncrementClause(column: ColumnDefinition): string {
    switch (this.driver) {
      case 'sqlite':
        return column.isPrimary ? ' PRIMARY KEY AUTOINCREMENT' : '';
      case 'postgres':
      case 'postgresql':
        return ''; // Already handled in type (SERIAL/BIGSERIAL)
      case 'mysql':
        return ''; // Already handled in type
      default:
        return column.isPrimary ? ' PRIMARY KEY AUTOINCREMENT' : '';
    }
  }

  /**
   * Get default value SQL
   */
  protected getDefaultValue(value: any): string {
    if (value === null) {
      return 'NULL';
    }

    if (typeof value === 'string') {
      return `'${value}'`;
    }

    if (typeof value === 'boolean') {
      if (this.driver === 'postgres' || this.driver === 'postgresql') {
        return value ? 'TRUE' : 'FALSE';
      }
      return value ? '1' : '0';
    }

    return String(value);
  }

  /**
   * Compile ADD COLUMN statement
   */
  protected compileAddColumn(tableName: string, column: ColumnDefinition): string {
    const columnDef = this.compileColumnDefinition(column);
    return `ALTER TABLE ${this.wrapTable(tableName)} ADD COLUMN ${columnDef}`;
  }

  /**
   * Compile command (drop, rename, etc.)
   */
  protected compileCommand(tableName: string, command: any): string | null {
    switch (command.type) {
      case 'dropColumn':
        return this.compileDropColumn(tableName, command.columns);
      case 'dropIndex':
        return this.compileDropIndex(tableName, command.name);
      case 'dropForeign':
        return this.compileDropForeign(tableName, command.name);
      case 'renameColumn':
        return this.compileRenameColumn(tableName, command.from, command.to);
      default:
        return null;
    }
  }

  /**
   * Compile DROP COLUMN statement
   */
  protected compileDropColumn(tableName: string, columns: string[]): string {
    const cols = columns.map((col) => `DROP COLUMN ${this.wrap(col)}`).join(', ');
    return `ALTER TABLE ${this.wrapTable(tableName)} ${cols}`;
  }

  /**
   * Compile DROP INDEX statement
   */
  protected compileDropIndex(tableName: string, indexName: string): string {
    if (this.driver === 'mysql') {
      return `ALTER TABLE ${this.wrapTable(tableName)} DROP INDEX ${this.wrap(indexName)}`;
    }
    return `DROP INDEX ${this.wrap(indexName)}`;
  }

  /**
   * Compile DROP FOREIGN KEY statement
   */
  protected compileDropForeign(tableName: string, keyName: string): string {
    return `ALTER TABLE ${this.wrapTable(tableName)} DROP FOREIGN KEY ${this.wrap(keyName)}`;
  }

  /**
   * Compile RENAME COLUMN statement
   */
  protected compileRenameColumn(tableName: string, from: string, to: string): string {
    if (this.driver === 'sqlite') {
      // SQLite doesn't support RENAME COLUMN directly in older versions
      return `ALTER TABLE ${this.wrapTable(tableName)} RENAME COLUMN ${this.wrap(from)} TO ${this.wrap(to)}`;
    }
    return `ALTER TABLE ${this.wrapTable(tableName)} RENAME COLUMN ${this.wrap(from)} TO ${this.wrap(to)}`;
  }

  /**
   * Compile index creation
   */
  protected compileIndex(tableName: string, index: any): string | null {
    if (index.type === 'primary') {
      // Primary keys are handled in CREATE TABLE
      return null;
    }

    const columns = index.columns.map((col: string) => this.wrap(col)).join(', ');
    const indexName = index.name || this.createIndexName(tableName, index.columns, index.type);

    if (index.type === 'unique') {
      return `CREATE UNIQUE INDEX ${this.wrap(indexName)} ON ${this.wrapTable(tableName)} (${columns})`;
    }

    return `CREATE INDEX ${this.wrap(indexName)} ON ${this.wrapTable(tableName)} (${columns})`;
  }

  /**
   * Compile foreign key creation
   */
  protected compileForeignKey(tableName: string, fk: ForeignKeyDefinition): string | null {
    if (!fk.referencedTable || !fk.referencedColumns) {
      return null;
    }

    const columns = fk.columns.map((col) => this.wrap(col)).join(', ');
    const refColumns = fk.referencedColumns.map((col) => this.wrap(col)).join(', ');
    const keyName = fk.name || this.createForeignKeyName(tableName, fk.columns);

    let sql = `ALTER TABLE ${this.wrapTable(tableName)} ADD CONSTRAINT ${this.wrap(keyName)} `;
    sql += `FOREIGN KEY (${columns}) REFERENCES ${this.wrapTable(fk.referencedTable)} (${refColumns})`;

    if (fk.onDeleteAction) {
      sql += ` ON DELETE ${fk.onDeleteAction.toUpperCase()}`;
    }

    if (fk.onUpdateAction) {
      sql += ` ON UPDATE ${fk.onUpdateAction.toUpperCase()}`;
    }

    return sql;
  }

  /**
   * Compile RENAME TABLE statement
   */
  protected compileRename(from: string, to: string): string {
    return `ALTER TABLE ${this.wrapTable(from)} RENAME TO ${this.wrapTable(to)}`;
  }

  /**
   * Compile has table check
   */
  protected compileHasTable(tableName: string): string {
    switch (this.driver) {
      case 'sqlite':
        return `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`;
      case 'postgres':
      case 'postgresql':
        return `SELECT tablename FROM pg_tables WHERE tablename='${tableName}'`;
      case 'mysql':
        return `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_NAME='${tableName}'`;
      default:
        return `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`;
    }
  }

  /**
   * Compile has column check
   */
  protected compileHasColumn(tableName: string, columnName: string): string {
    switch (this.driver) {
      case 'sqlite':
        return `PRAGMA table_info(${tableName})`;
      case 'postgres':
      case 'postgresql':
        return `SELECT column_name FROM information_schema.columns WHERE table_name='${tableName}' AND column_name='${columnName}'`;
      case 'mysql':
        return `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_NAME='${tableName}' AND COLUMN_NAME='${columnName}'`;
      default:
        return `PRAGMA table_info(${tableName})`;
    }
  }

  /**
   * Create index name
   */
  protected createIndexName(tableName: string, columns: string[], type: string): string {
    const suffix = type === 'unique' ? 'unique' : 'index';
    return `${tableName}_${columns.join('_')}_${suffix}`;
  }

  /**
   * Create foreign key name
   */
  protected createForeignKeyName(tableName: string, columns: string[]): string {
    return `${tableName}_${columns.join('_')}_foreign`;
  }

  /**
   * Wrap a table name
   */
  protected wrapTable(table: string): string {
    return this.wrap(table);
  }

  /**
   * Wrap an identifier
   */
  protected wrap(value: string): string {
    switch (this.driver) {
      case 'postgres':
      case 'postgresql':
        return `"${value}"`;
      case 'mysql':
        return `\`${value}\``;
      case 'sqlite':
      default:
        return `"${value}"`;
    }
  }
}
