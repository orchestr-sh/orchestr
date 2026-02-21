/**
 * Blueprint
 *
 * Defines a table schema in a migration
 */

import { Blueprint as IBlueprint } from '@/Database/Contracts/Schema';
import { ColumnDefinition } from './ColumnDefinition';
import { ForeignKeyDefinition } from './ForeignKeyDefinition';

export interface IndexDefinition {
  columns: string[];
  name?: string;
  type: 'index' | 'unique' | 'primary';
}

export interface DropCommand {
  type: 'dropColumn' | 'dropIndex' | 'dropForeign' | 'renameColumn';
  name?: string;
  columns?: string[];
  from?: string;
  to?: string;
}

export class Blueprint implements IBlueprint {
  public columns: ColumnDefinition[] = [];
  public indexes: IndexDefinition[] = [];
  public foreignKeys: ForeignKeyDefinition[] = [];
  public commands: DropCommand[] = [];
  public isCreate: boolean = false;

  constructor(public table: string) {}

  /**
   * Add an auto-incrementing ID column
   */
  id(column: string = 'id'): ColumnDefinition {
    const col = new ColumnDefinition(column, 'bigIncrements');
    col.isAutoIncrement = true;
    col.isPrimary = true;
    col.isUnsigned = true;
    this.columns.push(col);
    return col;
  }

  /**
   * Add a big auto-incrementing ID column
   */
  bigIncrements(column: string): ColumnDefinition {
    const col = new ColumnDefinition(column, 'bigIncrements');
    col.isAutoIncrement = true;
    col.isUnsigned = true;
    this.columns.push(col);
    return col;
  }

  /**
   * Add an auto-incrementing column
   */
  increments(column: string): ColumnDefinition {
    const col = new ColumnDefinition(column, 'increments');
    col.isAutoIncrement = true;
    col.isUnsigned = true;
    this.columns.push(col);
    return col;
  }

  /**
   * Add a UUID column
   */
  uuid(column: string): ColumnDefinition {
    const col = new ColumnDefinition(column, 'uuid');
    col.length = 36;
    this.columns.push(col);
    return col;
  }

  /**
   * Add a string column
   */
  string(column: string, length: number = 255): ColumnDefinition {
    const col = new ColumnDefinition(column, 'string');
    col.length = length;
    this.columns.push(col);
    return col;
  }

  /**
   * Add a text column
   */
  text(column: string): ColumnDefinition {
    const col = new ColumnDefinition(column, 'text');
    this.columns.push(col);
    return col;
  }

  /**
   * Add a medium text column
   */
  mediumText(column: string): ColumnDefinition {
    const col = new ColumnDefinition(column, 'mediumText');
    this.columns.push(col);
    return col;
  }

  /**
   * Add a long text column
   */
  longText(column: string): ColumnDefinition {
    const col = new ColumnDefinition(column, 'longText');
    this.columns.push(col);
    return col;
  }

  /**
   * Add an integer column
   */
  integer(column: string): ColumnDefinition {
    const col = new ColumnDefinition(column, 'integer');
    this.columns.push(col);
    return col;
  }

  /**
   * Add a big integer column
   */
  bigInteger(column: string): ColumnDefinition {
    const col = new ColumnDefinition(column, 'bigInteger');
    this.columns.push(col);
    return col;
  }

  /**
   * Add a small integer column
   */
  smallInteger(column: string): ColumnDefinition {
    const col = new ColumnDefinition(column, 'smallInteger');
    this.columns.push(col);
    return col;
  }

  /**
   * Add a tiny integer column
   */
  tinyInteger(column: string): ColumnDefinition {
    const col = new ColumnDefinition(column, 'tinyInteger');
    this.columns.push(col);
    return col;
  }

  /**
   * Add a decimal column
   */
  decimal(column: string, precision: number = 8, scale: number = 2): ColumnDefinition {
    const col = new ColumnDefinition(column, 'decimal');
    col.precision = precision;
    col.scale = scale;
    this.columns.push(col);
    return col;
  }

  /**
   * Add a float column
   */
  float(column: string, precision?: number, scale?: number): ColumnDefinition {
    const col = new ColumnDefinition(column, 'float');
    col.precision = precision;
    col.scale = scale;
    this.columns.push(col);
    return col;
  }

  /**
   * Add a double column
   */
  double(column: string, precision?: number, scale?: number): ColumnDefinition {
    const col = new ColumnDefinition(column, 'double');
    col.precision = precision;
    col.scale = scale;
    this.columns.push(col);
    return col;
  }

  /**
   * Add a boolean column
   */
  boolean(column: string): ColumnDefinition {
    const col = new ColumnDefinition(column, 'boolean');
    this.columns.push(col);
    return col;
  }

  /**
   * Add a date column
   */
  date(column: string): ColumnDefinition {
    const col = new ColumnDefinition(column, 'date');
    this.columns.push(col);
    return col;
  }

  /**
   * Add a datetime column
   */
  datetime(column: string, precision?: number): ColumnDefinition {
    const col = new ColumnDefinition(column, 'datetime');
    col.precision = precision;
    this.columns.push(col);
    return col;
  }

  /**
   * Add a timestamp column
   */
  timestamp(column: string, precision?: number): ColumnDefinition {
    const col = new ColumnDefinition(column, 'timestamp');
    col.precision = precision;
    this.columns.push(col);
    return col;
  }

  /**
   * Add created_at and updated_at timestamp columns
   */
  timestamps(precision?: number): void {
    this.timestamp('created_at', precision).nullable();
    this.timestamp('updated_at', precision).nullable();
  }

  /**
   * Add a JSON column
   */
  json(column: string): ColumnDefinition {
    const col = new ColumnDefinition(column, 'json');
    this.columns.push(col);
    return col;
  }

  /**
   * Add a JSONB column
   */
  jsonb(column: string): ColumnDefinition {
    const col = new ColumnDefinition(column, 'jsonb');
    this.columns.push(col);
    return col;
  }

  /**
   * Add a binary column
   */
  binary(column: string): ColumnDefinition {
    const col = new ColumnDefinition(column, 'binary');
    this.columns.push(col);
    return col;
  }

  /**
   * Add an enum column
   */
  enum(column: string, values: string[]): ColumnDefinition {
    const col = new ColumnDefinition(column, 'enum');
    col.enumValues = values;
    this.columns.push(col);
    return col;
  }

  /**
   * Add a remember token column
   */
  rememberToken(): ColumnDefinition {
    return this.string('remember_token', 100).nullable();
  }

  /**
   * Add soft delete columns
   */
  softDeletes(column: string = 'deleted_at'): ColumnDefinition {
    return this.timestamp(column).nullable();
  }

  /**
   * Add an index
   */
  index(columns: string | string[], indexName?: string): void {
    this.indexes.push({
      columns: Array.isArray(columns) ? columns : [columns],
      name: indexName,
      type: 'index',
    });
  }

  /**
   * Add a unique index
   */
  unique(columns: string | string[], indexName?: string): void {
    this.indexes.push({
      columns: Array.isArray(columns) ? columns : [columns],
      name: indexName,
      type: 'unique',
    });
  }

  /**
   * Add a primary key
   */
  primary(columns: string | string[]): void {
    this.indexes.push({
      columns: Array.isArray(columns) ? columns : [columns],
      type: 'primary',
    });
  }

  /**
   * Add a foreign key
   */
  foreign(columns: string | string[], indexName?: string): ForeignKeyDefinition {
    const fk = new ForeignKeyDefinition(columns, indexName);
    this.foreignKeys.push(fk);
    return fk;
  }

  /**
   * Drop a column
   */
  dropColumn(column: string | string[]): void {
    this.commands.push({
      type: 'dropColumn',
      columns: Array.isArray(column) ? column : [column],
    });
  }

  /**
   * Drop an index
   */
  dropIndex(indexName: string): void {
    this.commands.push({
      type: 'dropIndex',
      name: indexName,
    });
  }

  /**
   * Drop a foreign key
   */
  dropForeign(indexName: string): void {
    this.commands.push({
      type: 'dropForeign',
      name: indexName,
    });
  }

  /**
   * Rename a column
   */
  renameColumn(from: string, to: string): void {
    this.commands.push({
      type: 'renameColumn',
      from,
      to,
    });
  }
}
