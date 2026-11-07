/**
 * SQLite Schema Grammar
 *
 * Compiles schema statements for SQLite (the `sqlite` / `better-sqlite3`
 * drivers).
 *
 * SQLite shapes the schema rules the other dialects do not share: an
 * auto-incrementing key only exists as `INTEGER PRIMARY KEY AUTOINCREMENT`
 * declared on the column, a foreign key can only be written as part of the
 * `CREATE TABLE` statement, and an `ALTER TABLE` statement carries exactly one
 * action.
 */

import type { Blueprint } from '../Blueprint';
import type { ColumnDefinition } from '../ColumnDefinition';
import { SchemaGrammar } from './SchemaGrammar';

export class SqliteSchemaGrammar extends SchemaGrammar {
  /**
   * SQLite quotes identifiers with double quotes.
   */
  protected readonly wrapGlyph = '"';

  /**
   * SQLite rolls DDL back with the rest of the transaction.
   */
  supportsSchemaTransactions(): boolean {
    return true;
  }

  /**
   * An auto-incrementing key has to be declared inside the column definition
   * for `AUTOINCREMENT` to apply.
   */
  protected inlinesPrimaryKey(): boolean {
    return true;
  }

  /**
   * Foreign keys can only be written while the table is created.
   */
  protected inlinesForeignKeys(): boolean {
    return true;
  }

  /**
   * SQLite types: everything numeric collapses onto INTEGER and text onto the
   * VARCHAR/TEXT family, because storage classes are affinities, not limits.
   */
  protected typeFor(column: ColumnDefinition): string {
    switch (column.type) {
      case 'bigIncrements':
      case 'increments':
      case 'bigInteger':
      case 'integer':
      case 'smallInteger':
      case 'tinyInteger':
      case 'boolean':
        return 'INTEGER';
      case 'string':
      case 'uuid':
      case 'ulid':
        return this.varcharType(column);
      case 'text':
      case 'mediumText':
      case 'longText':
      case 'json':
      case 'jsonb':
      case 'enum':
        return 'TEXT';
      case 'decimal':
      case 'float':
      case 'double':
        return 'REAL';
      case 'date':
        return 'DATE';
      case 'datetime':
      case 'timestamp':
        return 'DATETIME';
      case 'binary':
        return 'BLOB';
      default:
        return this.unsupported(`the column type [${column.type}]`);
    }
  }

  /**
   * `AUTOINCREMENT` is only legal as part of an inline primary key.
   */
  protected compileAutoIncrement(column: ColumnDefinition): string {
    return column.isAutoIncrement ? ' PRIMARY KEY AUTOINCREMENT' : '';
  }

  /**
   * SQLite stores booleans as integers, like the query grammar renders them.
   */
  protected parameterizeBoolean(value: boolean): string {
    return value ? '1' : '0';
  }

  /**
   * SQLite performs one action per `ALTER TABLE`, so each column is dropped in
   * its own statement.
   */
  protected compileDropColumns(blueprint: Blueprint, columns: string[]): string[] {
    if (columns.length === 0) {
      throw new Error('Cannot drop columns without naming at least one column.');
    }

    return columns.map((column) => `ALTER TABLE ${this.wrapTable(blueprint.table)} DROP COLUMN ${this.wrap(column)}`);
  }

  /**
   * A foreign key constraint cannot be dropped: SQLite has no statement for it.
   */
  protected compileDropForeign(blueprint: Blueprint, name: string): string[] {
    return this.unsupported('dropping foreign key constraints');
  }

  /**
   * A primary key cannot be dropped without rebuilding the table.
   */
  protected compileDropPrimary(blueprint: Blueprint): string[] {
    return this.unsupported('dropping primary keys');
  }

  /**
   * Changing a column would mean rebuilding the table.
   */
  protected compileChange(blueprint: Blueprint, column: ColumnDefinition): string[] {
    return this.unsupported('modifying table columns');
  }

  /**
   * SQLite can switch constraint checking off for the connection.
   */
  compileDisableForeignKeyConstraints(): string {
    return 'PRAGMA foreign_keys = OFF';
  }

  /**
   * ...and back on again.
   */
  compileEnableForeignKeyConstraints(): string {
    return 'PRAGMA foreign_keys = ON';
  }

  /**
   * SQLite keeps its catalog in `sqlite_master`.
   */
  compileHasTable(tableName: string): string {
    return `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" = ${this.quoteLiteral(tableName)}`;
  }

  /**
   * The pragma lists every column of the table, each with its `name`; the
   * builder filters the rows, so asking about a missing column answers false.
   */
  compileColumnListing(tableName: string): string {
    return `PRAGMA table_info(${this.wrapTable(tableName)})`;
  }
}
