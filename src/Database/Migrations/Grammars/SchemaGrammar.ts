/**
 * Schema Grammar
 *
 * Compiles a `Blueprint` into DDL statements for one database dialect.
 *
 * Every dialect decision lives here: how a column type is spelled, whether an
 * auto-incrementing key is declared inline or as a table constraint, what a
 * default value literal looks like, where an index or a foreign key may be
 * attached, and which catalog query answers `hasTable` / `hasColumn`. The
 * schema builder owns the fluent API and executes statements; adding a driver
 * means adding a grammar subclass, never editing the builder.
 *
 * It extends the query grammar so both halves of the compiler share one set of
 * identifier-wrapping and literal-quoting rules.
 */

import { QueryGrammar } from '@/Database/Query/Grammars';
import type { Blueprint, BlueprintCommand, IndexDefinition } from '../Blueprint';
import type { ColumnDefinition } from '../ColumnDefinition';
import type { ForeignKeyDefinition } from '../ForeignKeyDefinition';

/**
 * The slice of a connection a grammar needs: run a statement, read some rows.
 */
export interface SchemaConnection {
  query(sql: string, bindings?: any[]): Promise<any>;
  select<T = any>(sql: string, bindings?: any[]): Promise<T[]>;
}

/**
 * A column type every dialect is expected to understand. Dialects map these
 * onto their own spellings and list what they add (`ulid`, `jsonb`, ...).
 */
const KNOWN_COLUMN_TYPES = new Set([
  'bigIncrements',
  'bigInteger',
  'binary',
  'boolean',
  'date',
  'datetime',
  'decimal',
  'double',
  'enum',
  'float',
  'increments',
  'integer',
  'json',
  'jsonb',
  'longText',
  'mediumText',
  'smallInteger',
  'string',
  'text',
  'timestamp',
  'tinyInteger',
  'ulid',
  'uuid',
]);

export abstract class SchemaGrammar extends QueryGrammar {
  // -------------------------------------------------------------------------
  // Dialect capabilities
  // -------------------------------------------------------------------------

  /**
   * Whether the dialect keeps DDL statements inside a transaction. PostgreSQL
   * and SQLite do; MySQL implicitly commits, so a migration there runs without
   * a wrapping transaction instead of pretending it has one.
   */
  supportsSchemaTransactions(): boolean {
    return false;
  }

  /**
   * Whether a primary key is declared inside the column definition instead of
   * as a table constraint. SQLite requires this for `AUTOINCREMENT` to apply.
   */
  protected inlinesPrimaryKey(): boolean {
    return false;
  }

  /**
   * Whether foreign keys have to be part of the `CREATE TABLE` statement.
   * SQLite cannot attach one to an existing table, so its grammar inlines them.
   */
  protected inlinesForeignKeys(): boolean {
    return false;
  }

  // -------------------------------------------------------------------------
  // Statements
  // -------------------------------------------------------------------------

  /**
   * Compile every statement needed to create a new table, in execution order.
   */
  compileCreate(blueprint: Blueprint): string[] {
    return this.statements([
      this.compileCreateTable(blueprint),
      ...this.compileIndexes(blueprint),
      ...this.compileForeignKeys(blueprint, true),
    ]);
  }

  /**
   * Compile every statement needed to alter an existing table, in execution
   * order: new columns, then commands, then indexes and foreign keys.
   */
  compileAlter(blueprint: Blueprint): string[] {
    const statements: string[] = [];

    for (const column of blueprint.columns) {
      statements.push(this.compileAddColumn(blueprint, column));
    }

    for (const command of blueprint.commands) {
      statements.push(...this.compileCommand(blueprint, command));
    }

    statements.push(...this.compileIndexes(blueprint));
    statements.push(...this.compileForeignKeys(blueprint, false));

    return this.statements(statements);
  }

  /**
   * Compile the `CREATE TABLE` statement itself.
   */
  protected compileCreateTable(blueprint: Blueprint): string {
    const primary = this.primaryKeyColumns(blueprint);
    const inlinePrimaryKey =
      this.inlinesPrimaryKey() &&
      primary.length === 1 &&
      blueprint.columns.some((column) => column.name === primary[0]);

    const columns = blueprint.columns
      .map((column) => this.compileColumnDefinition(column, inlinePrimaryKey))
      .join(', ');

    let sql = `CREATE TABLE ${this.wrapTable(blueprint.table)} (${columns}`;

    if (primary.length > 0 && !inlinePrimaryKey) {
      sql += `, PRIMARY KEY (${this.columnize(primary)})`;
    }

    sql += this.compileInlineForeignKeys(blueprint);

    return `${sql})`;
  }

  /**
   * Compile a single column definition.
   */
  compileColumnDefinition(column: ColumnDefinition, inlinePrimaryKey: boolean = this.inlinesPrimaryKey()): string {
    let sql = `${this.wrap(column.name)} ${this.columnType(column)}`;

    if (!column.isNullable) {
      sql += ' NOT NULL';
    }

    if (column.defaultValue !== undefined) {
      sql += ` DEFAULT ${this.compileDefaultValue(column)}`;
    }

    if (column.isAutoIncrement) {
      sql += this.compileAutoIncrement(column);
    } else if (column.isPrimary && inlinePrimaryKey) {
      sql += ' PRIMARY KEY';
    }

    return `${sql}${this.compileColumnPosition(column)}`;
  }

  /**
   * Compile `ALTER TABLE ... ADD COLUMN` for one column.
   */
  compileAddColumn(blueprint: Blueprint, column: ColumnDefinition): string {
    return `ALTER TABLE ${this.wrapTable(blueprint.table)} ADD COLUMN ${this.compileColumnDefinition(column)}`;
  }

  /**
   * Compile `DROP TABLE`.
   */
  compileDropTable(tableName: string): string {
    return `DROP TABLE ${this.wrapTable(tableName)}`;
  }

  /**
   * Compile `DROP TABLE IF EXISTS`.
   */
  compileDropTableIfExists(tableName: string): string {
    return `DROP TABLE IF EXISTS ${this.wrapTable(tableName)}`;
  }

  /**
   * Compile a table rename.
   */
  compileRenameTable(from: string, to: string): string {
    return `ALTER TABLE ${this.wrapTable(from)} RENAME TO ${this.wrapTable(to)}`;
  }

  // -------------------------------------------------------------------------
  // Column types
  // -------------------------------------------------------------------------

  /**
   * The SQL type for a column. Dialects override this; the base only checks
   * that the blueprint asked for a type the compiler knows about.
   */
  protected columnType(column: ColumnDefinition): string {
    if (!KNOWN_COLUMN_TYPES.has(column.type)) {
      throw new Error(`Unsupported column type [${column.type}] for column [${column.name}].`);
    }

    return this.typeFor(column);
  }

  /**
   * The dialect spelling of a column type.
   */
  protected abstract typeFor(column: ColumnDefinition): string;

  /**
   * The clause that makes a column auto-incrementing. Most dialects fold the
   * keyword into the type name and compile nothing here.
   */
  protected compileAutoIncrement(column: ColumnDefinition): string {
    return '';
  }

  /**
   * Column placement (`AFTER` / `FIRST`); only dialects that support it
   * override this.
   */
  protected compileColumnPosition(column: ColumnDefinition): string {
    return '';
  }

  /**
   * A `VARCHAR(n)` spelling shared by the dialects that use it, defaulting to
   * 255 like every other string column in the framework.
   */
  protected varcharType(column: ColumnDefinition): string {
    return column.length ? `VARCHAR(${this.integer(column.length, 'length')})` : 'VARCHAR(255)';
  }

  // -------------------------------------------------------------------------
  // Default values
  // -------------------------------------------------------------------------

  /**
   * The literal behind a column's `DEFAULT`.
   *
   * Strings are quoted with their inner quotes doubled, so a value can never
   * close the literal and append SQL. Raw SQL has to arrive wrapped in an
   * expression (`raw('CURRENT_TIMESTAMP')`) to be emitted verbatim; anything
   * the driver cannot represent as a literal is rejected instead of cast.
   */
  protected compileDefaultValue(column: ColumnDefinition): string {
    return this.defaultValueLiteral(column.defaultValue);
  }

  /**
   * Render a default value as a SQL literal.
   */
  protected defaultValueLiteral(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (this.isExpression(value)) {
      return this.rawSql(value);
    }

    if (typeof value === 'boolean') {
      return this.parameterizeBoolean(value);
    }

    if (typeof value === 'number' || typeof value === 'bigint') {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error(`Cannot use [${value}] as a column default value.`);
      }

      return String(value);
    }

    if (value instanceof Date) {
      return this.quoteLiteral(value.toISOString());
    }

    if (typeof value === 'string') {
      return this.quoteLiteral(value);
    }

    const kind = Array.isArray(value) ? 'array' : typeof value;

    throw new Error(
      `Cannot use a value of type "${kind}" as a column default value. ` +
        'Pass a primitive, or wrap raw SQL in raw(...).'
    );
  }

  // -------------------------------------------------------------------------
  // Indexes and foreign keys
  // -------------------------------------------------------------------------

  /**
   * Compile the standalone index statements for a blueprint. Primary keys are
   * part of the table definition and unique/index keys become their own
   * statements.
   */
  protected compileIndexes(blueprint: Blueprint): string[] {
    return blueprint.indexes
      .filter((index) => index.type !== 'primary')
      .map((index) => this.compileIndex(blueprint, index));
  }

  /**
   * Compile a `CREATE [UNIQUE] INDEX` statement.
   */
  compileIndex(blueprint: Blueprint, index: IndexDefinition): string {
    const keyword = index.type === 'unique' ? 'CREATE UNIQUE INDEX' : 'CREATE INDEX';
    const name = index.name || this.createIndexName(blueprint.table, index.columns, index.type);

    return `${keyword} ${this.wrap(name)} ON ${this.wrapTable(blueprint.table)} (${this.columnize(index.columns)})`;
  }

  /**
   * Compile the statements that attach the blueprint's foreign keys.
   *
   * A dialect that writes them inside the `CREATE TABLE` has nothing to attach
   * while creating, and no way to attach one to a table that already exists.
   */
  protected compileForeignKeys(blueprint: Blueprint, creating: boolean): string[] {
    if (blueprint.foreignKeys.length === 0) {
      return [];
    }

    if (this.inlinesForeignKeys()) {
      if (creating) {
        return [];
      }

      return this.unsupported('adding foreign keys to an existing table');
    }

    return blueprint.foreignKeys.map(
      (fk) =>
        `ALTER TABLE ${this.wrapTable(blueprint.table)} ADD ${this.compileForeignKey(fk, this.foreignKeyName(blueprint, fk))}`
    );
  }

  /**
   * Compile the `CONSTRAINT ... FOREIGN KEY ...` clause used both inline
   * (SQLite) and as part of an `ALTER TABLE ... ADD` statement.
   */
  compileForeignKey(fk: ForeignKeyDefinition, name: string): string {
    if (!fk.referencedTable || !fk.referencedColumns || fk.referencedColumns.length === 0) {
      throw new Error(
        `The foreign key on [${fk.columns.join(', ')}] is missing the column and table it references. ` +
          'Call references(...) and on(...) before the blueprint is compiled.'
      );
    }

    let sql = `CONSTRAINT ${this.wrap(name)} FOREIGN KEY (${this.columnize(fk.columns)}) `;
    sql += `REFERENCES ${this.wrapTable(fk.referencedTable)} (${this.columnize(fk.referencedColumns)})`;

    if (fk.onDeleteAction) {
      sql += ` ON DELETE ${this.foreignKeyAction(fk.onDeleteAction)}`;
    }

    if (fk.onUpdateAction) {
      sql += ` ON UPDATE ${this.foreignKeyAction(fk.onUpdateAction)}`;
    }

    return sql;
  }

  /**
   * The foreign key clauses embedded in a `CREATE TABLE` statement.
   */
  protected compileInlineForeignKeys(blueprint: Blueprint): string {
    if (!this.inlinesForeignKeys()) {
      return '';
    }

    return blueprint.foreignKeys
      .map((fk) => `, ${this.compileForeignKey(fk, this.foreignKeyName(blueprint, fk))}`)
      .join('');
  }

  /**
   * The name a foreign key constraint gets when the blueprint did not give one.
   */
  protected foreignKeyName(blueprint: Blueprint, fk: ForeignKeyDefinition): string {
    return fk.name || this.createForeignKeyName(blueprint.table, fk.columns);
  }

  /**
   * Validate and normalise a referential action so it cannot smuggle SQL.
   */
  protected foreignKeyAction(action: string): string {
    const normalized = String(action).trim().toLowerCase().replace(/\s+/g, ' ');

    if (!['cascade', 'set null', 'set default', 'restrict', 'no action'].includes(normalized)) {
      throw new Error(`Unsupported foreign key action [${action}].`);
    }

    return normalized.toUpperCase();
  }

  /**
   * Default index name for a set of columns, matching the convention Laravel
   * uses: `<table>_<columns>_index` / `_unique`.
   */
  createIndexName(tableName: string, columns: string[], type: string): string {
    const suffix = type === 'unique' ? 'unique' : 'index';

    return `${tableName}_${columns.join('_')}_${suffix}`;
  }

  /**
   * Default foreign key name for a set of columns: `<table>_<columns>_foreign`.
   */
  createForeignKeyName(tableName: string, columns: string[]): string {
    return `${tableName}_${columns.join('_')}_foreign`;
  }

  /**
   * The columns a primary key covers: table-level `primary()` declarations
   * plus columns that marked themselves primary.
   */
  protected primaryKeyColumns(blueprint: Blueprint): string[] {
    const columns = new Set<string>();

    for (const index of blueprint.indexes) {
      if (index.type === 'primary') {
        index.columns.forEach((column) => columns.add(column));
      }
    }

    for (const column of blueprint.columns) {
      if (column.isPrimary) {
        columns.add(column.name);
      }
    }

    return Array.from(columns);
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  /**
   * Compile one blueprint command into its statements.
   */
  compileCommand(blueprint: Blueprint, command: BlueprintCommand): string[] {
    switch (command.type) {
      case 'dropColumn':
        return this.compileDropColumns(blueprint, command.columns ?? []);
      case 'dropIndex':
        return this.compileDropIndex(blueprint, this.keyName(blueprint, command, 'index'));
      case 'dropUnique':
        return this.compileDropIndex(blueprint, this.keyName(blueprint, command, 'unique'));
      case 'dropPrimary':
        return this.compileDropPrimary(blueprint);
      case 'dropForeign':
        return this.compileDropForeign(blueprint, this.keyName(blueprint, command, 'foreign'));
      case 'renameColumn':
        return this.compileRenameColumn(blueprint, command.from ?? '', command.to ?? '');
      case 'renameIndex':
        return this.compileRenameIndex(blueprint, this.keyName(blueprint, command, 'index'), command.to ?? '');
      case 'change':
        return (command.definitions ?? []).flatMap((column) => this.compileChange(blueprint, column));
      default:
        throw new Error(`Unknown schema command [${String((command as { type: unknown }).type)}].`);
    }
  }

  /**
   * The name a key command refers to: the name the caller gave, or the name
   * this grammar would have generated for the columns it covers.
   */
  protected keyName(blueprint: Blueprint, command: BlueprintCommand, kind: 'index' | 'unique' | 'foreign'): string {
    if (command.name) {
      return command.name;
    }

    if (!command.columns || command.columns.length === 0) {
      throw new Error(`Cannot run the [${command.type}] command without a key name or the columns it covers.`);
    }

    return kind === 'foreign'
      ? this.createForeignKeyName(blueprint.table, command.columns)
      : this.createIndexName(blueprint.table, command.columns, kind);
  }

  /**
   * Compile `DROP COLUMN` for one or more columns.
   */
  protected compileDropColumns(blueprint: Blueprint, columns: string[]): string[] {
    if (columns.length === 0) {
      throw new Error('Cannot drop columns without naming at least one column.');
    }

    const dropped = columns.map((column) => `DROP COLUMN ${this.wrap(column)}`).join(', ');

    return [`ALTER TABLE ${this.wrapTable(blueprint.table)} ${dropped}`];
  }

  /**
   * Compile dropping a plain or unique index.
   */
  protected compileDropIndex(blueprint: Blueprint, name: string): string[] {
    if (!name) {
      throw new Error('Cannot drop an index without naming it.');
    }

    return [`DROP INDEX IF EXISTS ${this.wrap(name)}`];
  }

  /**
   * Compile dropping the primary key.
   */
  protected compileDropPrimary(blueprint: Blueprint): string[] {
    return this.unsupported('dropping primary keys');
  }

  /**
   * Compile dropping a foreign key constraint.
   */
  protected compileDropForeign(blueprint: Blueprint, name: string): string[] {
    return [`ALTER TABLE ${this.wrapTable(blueprint.table)} DROP CONSTRAINT ${this.wrap(name)}`];
  }

  /**
   * Compile `RENAME COLUMN`.
   */
  protected compileRenameColumn(blueprint: Blueprint, from: string, to: string): string[] {
    return [`ALTER TABLE ${this.wrapTable(blueprint.table)} RENAME COLUMN ${this.wrap(from)} TO ${this.wrap(to)}`];
  }

  /**
   * Compile renaming an index.
   */
  protected compileRenameIndex(blueprint: Blueprint, from: string, to: string): string[] {
    return this.unsupported('renaming indexes');
  }

  /**
   * Compile redefining an existing column.
   */
  protected compileChange(blueprint: Blueprint, column: ColumnDefinition): string[] {
    return this.unsupported('modifying table columns');
  }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  /**
   * The statement that answers "does this table exist", producing a row per
   * match with the table name in a `name` column.
   */
  abstract compileHasTable(tableName: string): string;

  /**
   * The statement that lists a table's columns, each with its name in a `name`
   * column. `hasColumn()` filters the rows, so a dialect can answer with a
   * catalog query or a pragma.
   */
  abstract compileColumnListing(tableName: string): string;

  /**
   * Whether a table exists.
   */
  async hasTable(connection: SchemaConnection, tableName: string): Promise<boolean> {
    const rows = await connection.select(this.compileHasTable(tableName));

    return rows.length > 0;
  }

  /**
   * Whether a table has the requested column.
   *
   * The listing is filtered here rather than in SQL so a dialect whose column
   * listing is a whole-table pragma (`PRAGMA table_info`) still answers for one
   * column and not for "any column".
   */
  async hasColumn(connection: SchemaConnection, tableName: string, columnName: string): Promise<boolean> {
    const rows = await connection.select<any[]>(this.compileColumnListing(tableName));

    return rows.some((row) => this.columnNameOf(row) === columnName);
  }

  /**
   * The name a column-listing row carries, whatever the driver called it.
   */
  protected columnNameOf(row: any): string {
    if (row === null || row === undefined) {
      return '';
    }

    if (typeof row !== 'object') {
      return String(row);
    }

    for (const key of ['name', 'column_name', 'COLUMN_NAME', 'Name']) {
      if (row[key] !== undefined && row[key] !== null) {
        return String(row[key]);
      }
    }

    return '';
  }

  // -------------------------------------------------------------------------
  // Foreign key constraint toggling
  // -------------------------------------------------------------------------

  /**
   * Whether the constraint toggle only affects the session that runs it.
   *
   * A pooled driver hands each statement to whichever connection is free, so on
   * such a dialect the toggle and the statements it protects have to be pinned
   * to one session for the toggle to apply at all.
   */
  requiresPinnedSessionForConstraintToggle(): boolean {
    return false;
  }

  /**
   * The statement that turns foreign key checking off for the session. An empty
   * string means the dialect has nothing to turn off, which is what a driver
   * without a switch compiles to.
   */
  compileDisableForeignKeyConstraints(): string {
    return '';
  }

  /**
   * The statement that turns foreign key checking back on.
   */
  compileEnableForeignKeyConstraints(): string {
    return '';
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Drop empty statements so a dialect can answer "nothing to run" with ''.
   */
  protected statements(statements: (string | null | undefined)[]): string[] {
    return statements.filter((statement): statement is string => typeof statement === 'string' && statement !== '');
  }

  /**
   * Fail with the message Laravel uses for operations a driver cannot express.
   */
  protected unsupported(feature: string): never {
    throw new Error(`This database driver does not support ${feature}.`);
  }
}
