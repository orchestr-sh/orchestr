/**
 * PostgreSQL Schema Grammar
 *
 * Compiles schema statements for PostgreSQL (the `postgres` / `postgresjs`
 * drivers).
 */

import type { Blueprint } from '../Blueprint';
import type { ColumnDefinition } from '../ColumnDefinition';
import { SchemaGrammar } from './SchemaGrammar';

export class PostgresSchemaGrammar extends SchemaGrammar {
  /**
   * PostgreSQL quotes identifiers with double quotes.
   */
  protected readonly wrapGlyph = '"';

  /**
   * PostgreSQL is the dialect that keeps DDL in transactions, which is why
   * migrations run inside one here.
   */
  supportsSchemaTransactions(): boolean {
    return true;
  }

  /**
   * PostgreSQL native types. `SERIAL`/`BIGSERIAL` carry the auto-incrementing
   * behaviour, so no separate clause is compiled for it.
   */
  protected typeFor(column: ColumnDefinition): string {
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
      case 'ulid':
        return this.varcharType(column);
      case 'uuid':
        return 'UUID';
      case 'text':
      case 'mediumText':
      case 'longText':
        return 'TEXT';
      case 'decimal':
        return this.decimalType(column, 'DECIMAL');
      case 'float':
        return 'REAL';
      case 'double':
        return 'DOUBLE PRECISION';
      case 'boolean':
        return 'BOOLEAN';
      case 'date':
        return 'DATE';
      case 'datetime':
      case 'timestamp':
        return column.precision ? `TIMESTAMP(${this.integer(column.precision, 'precision')})` : 'TIMESTAMP';
      case 'json':
        return 'JSON';
      case 'jsonb':
        return 'JSONB';
      case 'binary':
        return 'BYTEA';
      case 'enum':
        // A real PostgreSQL enum is a type of its own and has to be created
        // separately, so a plain varchar keeps migrations single-statement.
        return 'VARCHAR(255)';
      default:
        return this.unsupported(`the column type [${column.type}]`);
    }
  }

  /**
   * Boolean defaults use PostgreSQL's own literals rather than the `1`/`0`
   * spelling the SQLite grammar borrows from the query layer.
   */
  protected parameterizeBoolean(value: boolean): string {
    return value ? 'TRUE' : 'FALSE';
  }

  /**
   * The primary key constraint follows PostgreSQL's default naming, which is
   * what a table created by this framework carries.
   */
  protected compileDropPrimary(blueprint: Blueprint): string[] {
    return [`ALTER TABLE ${this.wrapTable(blueprint.table)} DROP CONSTRAINT ${this.wrap(`${blueprint.table}_pkey`)}`];
  }

  /**
   * Renaming an index keeps its definition and its name in the catalog.
   */
  protected compileRenameIndex(blueprint: Blueprint, from: string, to: string): string[] {
    return [`ALTER INDEX ${this.wrap(from)} RENAME TO ${this.wrap(to)}`];
  }

  /**
   * PostgreSQL can redefine a column in place, one statement per attribute.
   */
  protected compileChange(blueprint: Blueprint, column: ColumnDefinition): string[] {
    if (column.isAutoIncrement) {
      throw new Error(
        `Cannot make [${blueprint.table}.${column.name}] auto-incrementing: attaching a sequence to an existing column is not supported.`
      );
    }

    const table = this.wrapTable(blueprint.table);
    const name = this.wrap(column.name);

    const statements = [`ALTER TABLE ${table} ALTER COLUMN ${name} TYPE ${this.columnType(column)}`];

    if (column.isNullable) {
      statements.push(`ALTER TABLE ${table} ALTER COLUMN ${name} DROP NOT NULL`);
    } else {
      statements.push(`ALTER TABLE ${table} ALTER COLUMN ${name} SET NOT NULL`);
    }

    if (column.defaultValue !== undefined) {
      statements.push(`ALTER TABLE ${table} ALTER COLUMN ${name} SET DEFAULT ${this.compileDefaultValue(column)}`);
    }

    if (column.isPrimary) {
      statements.push(
        `ALTER TABLE ${table} ADD CONSTRAINT ${this.wrap(`${blueprint.table}_pkey`)} PRIMARY KEY (${name})`
      );
    }

    return statements;
  }

  /**
   * PostgreSQL has no session switch for foreign keys: constraints are enforced
   * by deferrability, not by a toggle, so nothing is compiled and the
   * statements simply run.
   */
  compileDisableForeignKeyConstraints(): string {
    return '';
  }

  /**
   * ...and nothing to turn back on.
   */
  compileEnableForeignKeyConstraints(): string {
    return '';
  }

  /**
   * PostgreSQL has no constraint switch, so a drop takes the dependent tables
   * with it instead of relying on one. `dropAllTables` can therefore run in any
   * order.
   */
  compileDropTable(tableName: string): string {
    return `DROP TABLE ${this.wrapTable(tableName)} CASCADE`;
  }

  /**
   * ...and the guarded form cascades too.
   */
  compileDropTableIfExists(tableName: string): string {
    return `DROP TABLE IF EXISTS ${this.wrapTable(tableName)} CASCADE`;
  }

  /**
   * `pg_tables` covers the tables in the current search path.
   */
  compileHasTable(tableName: string): string {
    return (
      'SELECT "tablename" AS "name" FROM "pg_tables" ' +
      `WHERE "schemaname" NOT IN ('pg_catalog', 'information_schema') AND "tablename" = ${this.quoteLiteral(tableName)}`
    );
  }

  /**
   * The column list comes from the information schema for the current schema.
   */
  compileColumnListing(tableName: string): string {
    return (
      'SELECT "column_name" AS "name" FROM "information_schema"."columns" ' +
      `WHERE "table_schema" = current_schema() AND "table_name" = ${this.quoteLiteral(tableName)}`
    );
  }

  /**
   * The `DECIMAL(p, s)` spelling, validated so a precision cannot be text.
   */
  private decimalType(column: ColumnDefinition, keyword: string): string {
    if (column.precision === undefined || column.scale === undefined) {
      return `${keyword}(8, 2)`;
    }

    return `${keyword}(${this.integer(column.precision, 'precision')}, ${this.integer(column.scale, 'scale')})`;
  }
}
