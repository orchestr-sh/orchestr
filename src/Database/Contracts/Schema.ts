/**
 * Schema Interface
 *
 * Defines the contract for schema/migration operations
 */

export interface Schema {
  /**
   * Create a new table
   */
  create(tableName: string, callback: (table: Blueprint) => void): Promise<void>;

  /**
   * Modify an existing table
   */
  table(tableName: string, callback: (table: Blueprint) => void): Promise<void>;

  /**
   * Drop a table
   */
  drop(tableName: string): Promise<void>;

  /**
   * Drop a table if it exists
   */
  dropIfExists(tableName: string): Promise<void>;

  /**
   * Rename a table
   */
  rename(from: string, to: string): Promise<void>;

  /**
   * Determine if a table exists
   */
  hasTable(tableName: string): Promise<boolean>;

  /**
   * Determine if a column exists on a table
   */
  hasColumn(tableName: string, columnName: string): Promise<boolean>;

  /**
   * Turn foreign key enforcement off for the connection
   */
  disableForeignKeyConstraints(): Promise<void>;

  /**
   * Turn foreign key enforcement back on for the connection
   */
  enableForeignKeyConstraints(): Promise<void>;

  /**
   * Run a callback with foreign key enforcement switched off, restoring it
   * afterwards even when the callback throws.
   */
  withoutForeignKeyConstraints<T>(callback: () => Promise<T> | T): Promise<T>;
}

export interface Blueprint {
  /**
   * The table the blueprint describes
   */
  table: string;

  /**
   * Add an auto-incrementing ID column
   */
  id(column?: string): ColumnDefinition;

  /**
   * Add a big auto-incrementing ID column
   */
  bigIncrements(column: string): ColumnDefinition;

  /**
   * Add an auto-incrementing column
   */
  increments(column: string): ColumnDefinition;

  /**
   * Add a UUID column
   */
  uuid(column: string): ColumnDefinition;

  /**
   * Add a ULID column
   */
  ulid(column: string): ColumnDefinition;

  /**
   * Add a string column
   */
  string(column: string, length?: number): ColumnDefinition;

  /**
   * Add a text column
   */
  text(column: string): ColumnDefinition;

  /**
   * Add a medium text column
   */
  mediumText(column: string): ColumnDefinition;

  /**
   * Add a long text column
   */
  longText(column: string): ColumnDefinition;

  /**
   * Add an integer column
   */
  integer(column: string): ColumnDefinition;

  /**
   * Add a big integer column
   */
  bigInteger(column: string): ColumnDefinition;

  /**
   * Add an unsigned big integer column
   */
  unsignedBigInteger(column: string): ColumnDefinition;

  /**
   * Add a small integer column
   */
  smallInteger(column: string): ColumnDefinition;

  /**
   * Add a tiny integer column
   */
  tinyInteger(column: string): ColumnDefinition;

  /**
   * Add a decimal column
   */
  decimal(column: string, precision?: number, scale?: number): ColumnDefinition;

  /**
   * Add a float column
   */
  float(column: string, precision?: number, scale?: number): ColumnDefinition;

  /**
   * Add a double column
   */
  double(column: string, precision?: number, scale?: number): ColumnDefinition;

  /**
   * Add a boolean column
   */
  boolean(column: string): ColumnDefinition;

  /**
   * Add a date column
   */
  date(column: string): ColumnDefinition;

  /**
   * Add a datetime column
   */
  datetime(column: string, precision?: number): ColumnDefinition;

  /**
   * Add a timestamp column
   */
  timestamp(column: string, precision?: number): ColumnDefinition;

  /**
   * Add created_at and updated_at timestamp columns
   */
  timestamps(precision?: number): void;

  /**
   * Add a JSON column
   */
  json(column: string): ColumnDefinition;

  /**
   * Add a JSONB column
   */
  jsonb(column: string): ColumnDefinition;

  /**
   * Add a binary column
   */
  binary(column: string): ColumnDefinition;

  /**
   * Add an enum column
   */
  enum(column: string, values: string[]): ColumnDefinition;

  /**
   * Add a remember token column
   */
  rememberToken(): ColumnDefinition;

  /**
   * Add soft delete columns
   */
  softDeletes(column?: string): ColumnDefinition;

  /**
   * Add a foreign key column, ready to be pointed at a table with
   * `constrained()`
   */
  foreignId(column: string): ForeignIdColumnDefinition;

  /**
   * Add a foreign key column for a model: `foreignIdFor(User)` creates
   * `user_id` referencing the primary key of the `users` table.
   *
   * The model may be given as a class, an instance, or a plain name.
   */
  foreignIdFor(model: ModelIdentifier, column?: string): ForeignIdColumnDefinition;

  /**
   * Add the `<name>_type` and `<name>_id` columns of a polymorphic relation
   */
  morphs(name: string): void;

  /**
   * Add nullable `<name>_type` and `<name>_id` polymorphic relation columns
   */
  nullableMorphs(name: string): void;

  /**
   * Add an index
   */
  index(columns: string | string[], indexName?: string): void;

  /**
   * Add a unique index
   */
  unique(columns: string | string[], indexName?: string): void;

  /**
   * Add a primary key
   */
  primary(columns: string | string[]): void;

  /**
   * Add a foreign key
   */
  foreign(columns: string | string[], indexName?: string): ForeignKeyDefinition;

  /**
   * Drop a column
   */
  dropColumn(column: string | string[]): void;

  /**
   * Drop the created_at and updated_at columns, or one timestamp column by name
   */
  dropTimestamps(column?: string): void;

  /**
   * Drop the soft delete column
   */
  dropSoftDeletes(column?: string): void;

  /**
   * Drop an index by name, or by the columns it covers
   */
  dropIndex(columns: string | string[]): void;

  /**
   * Drop a unique index by name, or by the columns it covers
   */
  dropUnique(columns: string | string[]): void;

  /**
   * Drop the primary key
   */
  dropPrimary(): void;

  /**
   * Drop a foreign key by name, or by the columns it covers
   */
  dropForeign(columns: string | string[]): void;

  /**
   * Rename an index
   */
  renameIndex(from: string | string[], to: string): void;

  /**
   * Rename a column
   */
  renameColumn(from: string, to: string): void;

  /**
   * Redefine existing columns instead of adding them
   */
  change(column: ColumnDefinition | ColumnDefinition[]): void;
}

export interface ColumnDefinition {
  /**
   * Allow NULL values
   */
  nullable(): this;

  /**
   * Set a default value
   */
  default(value: any): this;

  /**
   * Mark as unsigned (for numeric types)
   */
  unsigned(): this;

  /**
   * Add a unique constraint
   */
  unique(indexName?: string): this;

  /**
   * Add an index
   */
  index(indexName?: string): this;

  /**
   * Set as primary key
   */
  primary(): this;

  /**
   * Add a comment
   */
  comment(comment: string): this;

  /**
   * Place column after another column
   */
  after(column: string): this;

  /**
   * Place column first
   */
  first(): this;

  /**
   * Redefine the column this definition describes instead of creating it
   */
  change(): this;
}

export interface ForeignKeyDefinition {
  /**
   * Specify the referenced column(s)
   */
  references(columns: string | string[]): this;

  /**
   * Specify the referenced table
   */
  on(table: string): this;

  /**
   * Set the ON DELETE action
   */
  onDelete(action: 'cascade' | 'set null' | 'restrict' | 'no action'): this;

  /**
   * Set the ON UPDATE action
   */
  onUpdate(action: 'cascade' | 'set null' | 'restrict' | 'no action'): this;
}

/**
 * The fluent foreign key column returned by `foreignId()` and
 * `foreignIdFor()`: an unsigned big integer that can attach its own constraint
 * and name its referential actions.
 */
export interface ForeignIdColumnDefinition extends ColumnDefinition {
  /**
   * Attach the foreign key constraint, deriving the table from the column name
   * when it is not given
   */
  constrained(referencedTable?: string, referencedColumn?: string): this;

  /**
   * Set the ON DELETE action
   */
  onDelete(action: 'cascade' | 'set null' | 'restrict' | 'no action'): this;

  /**
   * Set the ON UPDATE action
   */
  onUpdate(action: 'cascade' | 'set null' | 'restrict' | 'no action'): this;

  /**
   * Delete dependent rows with their parent
   */
  cascadeOnDelete(): this;

  /**
   * Update dependent rows with their parent
   */
  cascadeOnUpdate(): this;

  /**
   * Null out dependent rows when the parent is deleted
   */
  nullOnDelete(): this;

  /**
   * Null out dependent rows when the parent is updated
   */
  nullOnUpdate(): this;

  /**
   * Block deleting a row that is still referenced
   */
  restrictOnDelete(): this;

  /**
   * Block updating a row that is still referenced
   */
  restrictOnUpdate(): this;

  /**
   * Leave deletes to the database default
   */
  noActionOnDelete(): this;

  /**
   * Leave updates to the database default
   */
  noActionOnUpdate(): this;
}

/**
 * Anything `foreignIdFor()` can name a model with: the class, an instance of
 * it, or the model's name.
 */
export type ModelIdentifier = Function | { constructor: Function } | string;
