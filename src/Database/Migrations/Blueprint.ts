/**
 * Blueprint
 *
 * Defines a table schema in a migration
 */

import type { ModelIdentifier } from '@/Database/Contracts/Schema';
import { Blueprint as IBlueprint } from '@/Database/Contracts/Schema';
import { ColumnDefinition } from './ColumnDefinition';
import { ForeignIdColumnDefinition } from './ForeignIdColumnDefinition';
import { ForeignKeyDefinition } from './ForeignKeyDefinition';
import { pluralize, snakeCase } from './Naming';

export interface IndexDefinition {
  columns: string[];
  name?: string;
  type: 'index' | 'unique' | 'primary';
}

/**
 * A schema operation on an existing table: dropping something, renaming
 * something, or redefining a column.
 *
 * `name` is the constraint/index name when the caller gave one and `columns`
 * the columns it covers when they did not; the grammar turns the column list
 * into the name `index()`/`unique()`/`foreign()` would have generated, so the
 * naming rules live in one place.
 */
export interface BlueprintCommand {
  type:
    | 'dropColumn'
    | 'dropIndex'
    | 'dropUnique'
    | 'dropPrimary'
    | 'dropForeign'
    | 'renameColumn'
    | 'renameIndex'
    | 'change';
  /** Explicit name of the index, constraint or key the command targets. */
  name?: string;
  /** Columns the command drops or renames, or covers by name. */
  columns?: string[];
  /** Column or index being renamed from. */
  from?: string;
  /** Column or index being renamed to. */
  to?: string;
  /** Column definitions to reapply to existing columns. */
  definitions?: ColumnDefinition[];
}

/**
 * The previous name of the command type, kept so code that typed against it
 * still compiles.
 */
export type DropCommand = BlueprintCommand;

export class Blueprint implements IBlueprint {
  public columns: ColumnDefinition[] = [];
  public indexes: IndexDefinition[] = [];
  public foreignKeys: ForeignKeyDefinition[] = [];
  public commands: BlueprintCommand[] = [];
  public isCreate: boolean = false;

  constructor(public table: string) {}

  /**
   * Register a column definition so its modifiers can add indexes and changes
   * to the table it belongs to.
   */
  registerColumn(column: ColumnDefinition): ColumnDefinition {
    column.setBlueprint(this);
    this.columns.push(column);

    return column;
  }

  /**
   * Register an index on the table. Used by the column modifiers, where the
   * columns are already known.
   */
  addIndex(columns: string[], type: IndexDefinition['type'], indexName?: string): void {
    this.indexes.push({ columns, name: indexName, type });
  }

  /**
   * Add an auto-incrementing ID column
   */
  id(column: string = 'id'): ColumnDefinition {
    return this.bigIncrements(column);
  }

  /**
   * Add a big auto-incrementing ID column
   */
  bigIncrements(column: string): ColumnDefinition {
    const col = this.registerColumn(new ColumnDefinition(column, 'bigIncrements'));
    col.isAutoIncrement = true;
    col.isUnsigned = true;
    col.isPrimary = true;

    return col;
  }

  /**
   * Add an auto-incrementing column
   */
  increments(column: string): ColumnDefinition {
    const col = this.registerColumn(new ColumnDefinition(column, 'increments'));
    col.isAutoIncrement = true;
    col.isUnsigned = true;
    col.isPrimary = true;

    return col;
  }

  /**
   * Add a UUID column
   */
  uuid(column: string): ColumnDefinition {
    const col = this.registerColumn(new ColumnDefinition(column, 'uuid'));
    col.length = 36;

    return col;
  }

  /**
   * Add a ULID column: a 26 character sortable identifier.
   */
  ulid(column: string): ColumnDefinition {
    const col = this.registerColumn(new ColumnDefinition(column, 'ulid'));
    col.length = 26;

    return col;
  }

  /**
   * Add a string column
   */
  string(column: string, length: number = 255): ColumnDefinition {
    const col = this.registerColumn(new ColumnDefinition(column, 'string'));
    col.length = length;

    return col;
  }

  /**
   * Add a text column
   */
  text(column: string): ColumnDefinition {
    return this.registerColumn(new ColumnDefinition(column, 'text'));
  }

  /**
   * Add a medium text column
   */
  mediumText(column: string): ColumnDefinition {
    return this.registerColumn(new ColumnDefinition(column, 'mediumText'));
  }

  /**
   * Add a long text column
   */
  longText(column: string): ColumnDefinition {
    return this.registerColumn(new ColumnDefinition(column, 'longText'));
  }

  /**
   * Add an integer column
   */
  integer(column: string): ColumnDefinition {
    return this.registerColumn(new ColumnDefinition(column, 'integer'));
  }

  /**
   * Add a big integer column
   */
  bigInteger(column: string): ColumnDefinition {
    return this.registerColumn(new ColumnDefinition(column, 'bigInteger'));
  }

  /**
   * Add an unsigned big integer column
   */
  unsignedBigInteger(column: string): ColumnDefinition {
    return this.bigInteger(column).unsigned();
  }

  /**
   * Add a small integer column
   */
  smallInteger(column: string): ColumnDefinition {
    return this.registerColumn(new ColumnDefinition(column, 'smallInteger'));
  }

  /**
   * Add a tiny integer column
   */
  tinyInteger(column: string): ColumnDefinition {
    return this.registerColumn(new ColumnDefinition(column, 'tinyInteger'));
  }

  /**
   * Add a decimal column
   */
  decimal(column: string, precision: number = 8, scale: number = 2): ColumnDefinition {
    const col = this.registerColumn(new ColumnDefinition(column, 'decimal'));
    col.precision = precision;
    col.scale = scale;

    return col;
  }

  /**
   * Add a float column
   */
  float(column: string, precision?: number, scale?: number): ColumnDefinition {
    const col = this.registerColumn(new ColumnDefinition(column, 'float'));
    col.precision = precision;
    col.scale = scale;

    return col;
  }

  /**
   * Add a double column
   */
  double(column: string, precision?: number, scale?: number): ColumnDefinition {
    const col = this.registerColumn(new ColumnDefinition(column, 'double'));
    col.precision = precision;
    col.scale = scale;

    return col;
  }

  /**
   * Add a boolean column
   */
  boolean(column: string): ColumnDefinition {
    return this.registerColumn(new ColumnDefinition(column, 'boolean'));
  }

  /**
   * Add a date column
   */
  date(column: string): ColumnDefinition {
    return this.registerColumn(new ColumnDefinition(column, 'date'));
  }

  /**
   * Add a datetime column
   */
  datetime(column: string, precision?: number): ColumnDefinition {
    const col = this.registerColumn(new ColumnDefinition(column, 'datetime'));
    col.precision = precision;

    return col;
  }

  /**
   * Add a timestamp column
   */
  timestamp(column: string, precision?: number): ColumnDefinition {
    const col = this.registerColumn(new ColumnDefinition(column, 'timestamp'));
    col.precision = precision;

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
    return this.registerColumn(new ColumnDefinition(column, 'json'));
  }

  /**
   * Add a JSONB column
   */
  jsonb(column: string): ColumnDefinition {
    return this.registerColumn(new ColumnDefinition(column, 'jsonb'));
  }

  /**
   * Add a binary column
   */
  binary(column: string): ColumnDefinition {
    return this.registerColumn(new ColumnDefinition(column, 'binary'));
  }

  /**
   * Add an enum column
   */
  enum(column: string, values: string[]): ColumnDefinition {
    const col = this.registerColumn(new ColumnDefinition(column, 'enum'));
    col.enumValues = values;

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
   * Add a foreign key column: an unsigned big integer named after the table it
   * points at, ready to be attached with `constrained()`.
   */
  foreignId(column: string): ForeignIdColumnDefinition {
    const col = new ForeignIdColumnDefinition(column);
    this.registerColumn(col);

    return col;
  }

  /**
   * Add a foreign key column for a model: `foreignIdFor(User)` creates
   * `user_id` referencing the `id` column of the `users` table.
   */
  foreignIdFor(model: ModelIdentifier, column?: string): ForeignIdColumnDefinition {
    const instance = this.instantiateModel(model);
    const referencedTable: string = instance?.getTable?.() ?? pluralize(snakeCase(this.modelName(model)));
    const referencedColumn: string = instance?.getKeyName?.() ?? 'id';
    const columnName: string = column ?? instance?.getForeignKey?.() ?? `${snakeCase(this.modelName(model))}_id`;

    return this.foreignId(columnName).constrained(referencedTable, referencedColumn);
  }

  /**
   * Add the `<name>_type` and `<name>_id` columns of a polymorphic relation.
   */
  morphs(name: string): void {
    this.string(`${name}_type`);
    this.unsignedBigInteger(`${name}_id`);
  }

  /**
   * Add nullable `<name>_type` and `<name>_id` polymorphic relation columns.
   */
  nullableMorphs(name: string): void {
    this.string(`${name}_type`).nullable();
    this.unsignedBigInteger(`${name}_id`).nullable();
  }

  /**
   * Add an index
   */
  index(columns: string | string[], indexName?: string): void {
    this.addIndex(this.toArray(columns), 'index', indexName);
  }

  /**
   * Add a unique index
   */
  unique(columns: string | string[], indexName?: string): void {
    this.addIndex(this.toArray(columns), 'unique', indexName);
  }

  /**
   * Add a primary key
   */
  primary(columns: string | string[]): void {
    this.addIndex(this.toArray(columns), 'primary');
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
      columns: this.toArray(column),
    });
  }

  /**
   * Drop the created_at and updated_at columns, or one timestamp column by name.
   */
  dropTimestamps(column?: string): void {
    this.dropColumn(column ?? ['created_at', 'updated_at']);
  }

  /**
   * Drop the soft delete column
   */
  dropSoftDeletes(column: string = 'deleted_at'): void {
    this.dropColumn(column);
  }

  /**
   * Drop an index
   *
   * Accepts the index name, or the columns it covers, in which case the grammar
   * derives the name the same way `index()` generated it.
   */
  dropIndex(columns: string | string[]): void {
    this.commands.push(this.keyCommand('dropIndex', columns));
  }

  /**
   * Drop a unique index
   */
  dropUnique(columns: string | string[]): void {
    this.commands.push(this.keyCommand('dropUnique', columns));
  }

  /**
   * Drop the primary key
   */
  dropPrimary(): void {
    this.commands.push({ type: 'dropPrimary' });
  }

  /**
   * Drop a foreign key
   */
  dropForeign(columns: string | string[]): void {
    this.commands.push(this.keyCommand('dropForeign', columns));
  }

  /**
   * Rename an index
   */
  renameIndex(from: string | string[], to: string): void {
    this.commands.push(
      Array.isArray(from) ? { type: 'renameIndex', columns: from, to } : { type: 'renameIndex', name: from, to }
    );
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

  /**
   * Redefine existing columns instead of adding them.
   *
   * A definition that was just declared ( `$table->string('name')->change()` )
   * leaves the added-column list here, so the column is modified in place
   * instead of being created a second time.
   */
  change(column: ColumnDefinition | ColumnDefinition[]): void {
    const definitions = this.toArray(column);

    for (const definition of definitions) {
      const index = this.columns.indexOf(definition);

      if (index !== -1) {
        this.columns.splice(index, 1);
      }
    }

    this.commands.push({ type: 'change', definitions });
  }

  /**
   * A command that targets a named key, or the key a column list would have
   * generated.
   */
  protected keyCommand(type: 'dropIndex' | 'dropUnique' | 'dropForeign', columns: string | string[]): BlueprintCommand {
    return Array.isArray(columns) ? { type, columns } : { type, name: columns };
  }

  /**
   * The class name behind a model identifier: the constructor name, or the
   * string itself when a plain name was given.
   */
  protected modelName(model: ModelIdentifier): string {
    if (typeof model === 'string') {
      return model;
    }

    if (typeof model === 'function') {
      return model.name;
    }

    return model.constructor.name;
  }

  /**
   * Instantiate a model so its table and key names can be read. A model whose
   * constructor needs arguments is skipped rather than half-built, and the
   * naming conventions are used instead.
   */
  protected instantiateModel(model: ModelIdentifier): any {
    if (typeof model !== 'function') {
      return typeof model === 'object' && model !== null ? model : undefined;
    }

    try {
      return new (model as new (...args: any[]) => any)();
    } catch {
      return undefined;
    }
  }

  /**
   * Read a single item or a list of them as a list.
   */
  protected toArray<T>(value: T | T[]): T[] {
    return Array.isArray(value) ? (value as T[]) : [value as T];
  }
}
