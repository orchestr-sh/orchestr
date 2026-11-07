/**
 * MySQL Schema Grammar
 *
 * Compiles schema statements for MySQL and MariaDB (the `mysql` / `mysql2`
 * drivers).
 */

import { quoteMySqlLiteral } from '@/Database/Query/Grammars';
import type { Blueprint } from '../Blueprint';
import type { ColumnDefinition } from '../ColumnDefinition';
import { SchemaGrammar } from './SchemaGrammar';

export class MySqlSchemaGrammar extends SchemaGrammar {
  /**
   * MySQL quotes identifiers with backticks.
   */
  protected readonly wrapGlyph = '`';

  /**
   * MySQL strings honour backslash escapes as well as doubled quotes, so the
   * query grammar's MySQL literal rules are reused here rather than restated.
   */
  protected quoteLiteral(value: string): string {
    return quoteMySqlLiteral(value);
  }

  /**
   * MySQL booleans are tinyint values, like in the query grammar.
   */
  protected parameterizeBoolean(value: boolean): string {
    return value ? '1' : '0';
  }

  /**
   * MySQL commits implicitly around every DDL statement, so wrapping a
   * migration in a transaction would be theatre rather than protection.
   */
  supportsSchemaTransactions(): boolean {
    return false;
  }

  /**
   * MySQL types, including the unsigned integers Laravel's `foreignId()` and
   * `morphs()` rely on and the `ENUM(...)` list spelled with quoted values.
   */
  protected typeFor(column: ColumnDefinition): string {
    switch (column.type) {
      case 'bigIncrements':
        return 'BIGINT UNSIGNED';
      case 'increments':
        return 'INT UNSIGNED';
      case 'bigInteger':
        return column.isUnsigned ? 'BIGINT UNSIGNED' : 'BIGINT';
      case 'integer':
        return column.isUnsigned ? 'INT UNSIGNED' : 'INT';
      case 'smallInteger':
        return column.isUnsigned ? 'SMALLINT UNSIGNED' : 'SMALLINT';
      case 'tinyInteger':
        return column.isUnsigned ? 'TINYINT UNSIGNED' : 'TINYINT';
      case 'string':
        return this.varcharType(column);
      case 'uuid':
        return 'CHAR(36)';
      case 'ulid':
        return 'CHAR(26)';
      case 'text':
        return 'TEXT';
      case 'mediumText':
        return 'MEDIUMTEXT';
      case 'longText':
        return 'LONGTEXT';
      case 'decimal':
        return this.decimalType(column, 'DECIMAL');
      case 'float':
        return this.precisionPair(column, 'FLOAT');
      case 'double':
        return this.precisionPair(column, 'DOUBLE');
      case 'boolean':
        return 'TINYINT(1)';
      case 'date':
        return 'DATE';
      case 'datetime':
        return column.precision ? `DATETIME(${this.integer(column.precision, 'precision')})` : 'DATETIME';
      case 'timestamp':
        return column.precision ? `TIMESTAMP(${this.integer(column.precision, 'precision')})` : 'TIMESTAMP';
      case 'json':
      case 'jsonb':
        return 'JSON';
      case 'binary':
        return 'BLOB';
      case 'enum':
        return this.enumType(column);
      default:
        return this.unsupported(`the column type [${column.type}]`);
    }
  }

  /**
   * MySQL declares the counter on the column itself.
   */
  protected compileAutoIncrement(column: ColumnDefinition): string {
    return column.isAutoIncrement ? ' AUTO_INCREMENT' : '';
  }

  /**
   * `AFTER` and `FIRST` only mean something to MySQL among the supported
   * dialects.
   */
  protected compileColumnPosition(column: ColumnDefinition): string {
    if (column.isFirst) {
      return ' FIRST';
    }

    return column.afterColumn ? ` AFTER ${this.wrap(column.afterColumn)}` : '';
  }

  /**
   * MySQL indexes live on the table, so they are dropped through
   * `ALTER TABLE ... DROP INDEX`.
   */
  protected compileDropIndex(blueprint: Blueprint, name: string): string[] {
    if (!name) {
      throw new Error('Cannot drop an index without naming it.');
    }

    return [`ALTER TABLE ${this.wrapTable(blueprint.table)} DROP INDEX ${this.wrap(name)}`];
  }

  /**
   * The primary key has no name to reference in MySQL.
   */
  protected compileDropPrimary(blueprint: Blueprint): string[] {
    return [`ALTER TABLE ${this.wrapTable(blueprint.table)} DROP PRIMARY KEY`];
  }

  /**
   * MySQL spells a dropped constraint as a dropped foreign key.
   */
  protected compileDropForeign(blueprint: Blueprint, name: string): string[] {
    if (!name) {
      throw new Error('Cannot drop a foreign key without naming it.');
    }

    return [`ALTER TABLE ${this.wrapTable(blueprint.table)} DROP FOREIGN KEY ${this.wrap(name)}`];
  }

  /**
   * Renaming an index is a table operation in MySQL.
   */
  protected compileRenameIndex(blueprint: Blueprint, from: string, to: string): string[] {
    return [`ALTER TABLE ${this.wrapTable(blueprint.table)} RENAME INDEX ${this.wrap(from)} TO ${this.wrap(to)}`];
  }

  /**
   * `SET FOREIGN_KEY_CHECKS` is a session variable, and mysql2 checks a pooled
   * connection out per statement, so the toggle has to stay on one connection to
   * mean anything.
   */
  requiresPinnedSessionForConstraintToggle(): boolean {
    return true;
  }

  /**
   * The session-wide switch MySQL uses when constraints are turned off.
   */
  compileDisableForeignKeyConstraints(): string {
    return 'SET FOREIGN_KEY_CHECKS=0';
  }

  /**
   * ...and back on again.
   */
  compileEnableForeignKeyConstraints(): string {
    return 'SET FOREIGN_KEY_CHECKS=1';
  }

  /**
   * MySQL reads its catalog from `information_schema` for the current database.
   */
  compileHasTable(tableName: string): string {
    return (
      'SELECT `TABLE_NAME` AS `name` FROM `information_schema`.`TABLES` ' +
      'WHERE `TABLE_SCHEMA` = DATABASE() ' +
      `AND \`TABLE_NAME\` = ${this.quoteLiteral(tableName)}`
    );
  }

  /**
   * The column list is filtered to the current database as well, so a column of
   * the same name in another schema cannot answer for this one.
   */
  compileColumnListing(tableName: string): string {
    return (
      'SELECT `COLUMN_NAME` AS `name` FROM `information_schema`.`COLUMNS` ' +
      'WHERE `TABLE_SCHEMA` = DATABASE() ' +
      `AND \`TABLE_NAME\` = ${this.quoteLiteral(tableName)}`
    );
  }

  /**
   * The `ENUM('a', 'b')` spelling, with every value quoted as a literal so a
   * value containing a quote cannot break out of the list.
   */
  private enumType(column: ColumnDefinition): string {
    if (!column.enumValues || column.enumValues.length === 0) {
      return 'VARCHAR(255)';
    }

    const values = column.enumValues.map((value) => this.quoteLiteral(String(value))).join(', ');

    return `ENUM(${values})`;
  }

  /**
   * The `DECIMAL(p, s)` spelling, defaulting to Laravel's `8, 2`.
   */
  private decimalType(column: ColumnDefinition, keyword: string): string {
    if (column.precision === undefined || column.scale === undefined) {
      return `${keyword}(8, 2)`;
    }

    return `${keyword}(${this.integer(column.precision, 'precision')}, ${this.integer(column.scale, 'scale')})`;
  }

  /**
   * `FLOAT`/`DOUBLE` take an optional precision pair.
   */
  private precisionPair(column: ColumnDefinition, keyword: string): string {
    if (column.precision === undefined || column.scale === undefined) {
      return keyword;
    }

    return `${keyword}(${this.integer(column.precision, 'precision')}, ${this.integer(column.scale, 'scale')})`;
  }
}
