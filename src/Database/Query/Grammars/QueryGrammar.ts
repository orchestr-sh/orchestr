/**
 * Query Grammar
 *
 * Compiles query state into SQL for one database dialect.
 *
 * The builder owns query state and the fluent API; every dialect decision -
 * how identifiers are quoted, whether `INSERT ... RETURNING` exists, how a
 * generated key is read back, how a literal looks when interpolated - lives in
 * a grammar. Adding a driver therefore means adding a grammar subclass, not
 * editing `Builder`.
 */

import type { HavingClause, JoinClause, OrderByClause, WhereClause } from '@/Database/Contracts/QueryBuilderInterface';
import type { Expression } from '@/Database/Query/Expression';

/**
 * The state a grammar needs to compile a statement. It is a snapshot the builder
 * hands over; grammars never mutate it.
 */
export interface QueryState {
  table?: string;
  columns: (string | Expression)[];
  distinct: boolean;
  joins: JoinClause[];
  wheres: WhereClause[];
  groups: string[];
  havings: HavingClause[];
  orders: OrderByClause[];
  limit?: number;
  offset?: number;
  returning?: string[];
}

/**
 * Operators a grammar is willing to compile. Anything else is rejected, so an
 * operator can never smuggle raw SQL into a statement. `exists` and
 * `not exists` are the clause shapes a sub-select is wrapped in; the sub-select
 * itself always arrives as an expression.
 */
const OPERATORS = new Set([
  '=',
  '<',
  '>',
  '<=',
  '>=',
  '<>',
  '!=',
  'like',
  'not like',
  'ilike',
  'in',
  'not in',
  'between',
  'not between',
  'is null',
  'is not null',
  'exists',
  'not exists',
  'raw',
]);

/**
 * Operators whose value is a list of bindings instead of a single binding.
 */
const LIST_OPERATORS = new Set(['in', 'not in', 'between', 'not between']);

/**
 * Aggregate functions the grammar will wrap a column in.
 */
const AGGREGATE_FUNCTIONS = new Set(['count', 'min', 'max', 'avg', 'sum']);

/**
 * What may appear in a bare identifier: a leading letter or underscore followed
 * by letters, numbers, underscores and `$`, which every supported dialect
 * accepts inside a quoted name. Anything else fails loudly instead of being
 * interpolated into the statement.
 */
const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_$]*$/u;

export abstract class QueryGrammar {
  /**
   * The glyph that quotes identifiers in this dialect: `"` for SQLite and
   * PostgreSQL, a backtick for MySQL.
   */
  protected abstract readonly wrapGlyph: string;

  // -------------------------------------------------------------------------
  // Dialect capabilities
  // -------------------------------------------------------------------------

  /**
   * Whether the dialect supports a `RETURNING` clause on data-modifying
   * statements (SQLite 3.35+ and PostgreSQL do; MySQL does not).
   */
  supportsReturning(): boolean {
    return false;
  }

  /**
   * Whether a plain `INSERT` reports the generated key through the driver result
   * (SQLite's `lastInsertRowid`, MySQL's `insertId`) instead of having to ask
   * for it with `RETURNING`.
   */
  usesLastInsertId(): boolean {
    return true;
  }

  /**
   * The column that carries a generated key for `insertGetId()`: the sequence
   * argument first, then a configured `returning()` column, then `id`.
   */
  generatedKeyColumn(query: QueryState, sequence?: string): string {
    if (sequence) {
      return sequence;
    }

    const configured = (query.returning ?? []).filter((column) => column !== '*');

    return configured.length > 0 ? configured[0] : 'id';
  }

  // -------------------------------------------------------------------------
  // Select
  // -------------------------------------------------------------------------

  /**
   * Compile a select statement from query state.
   */
  compileSelect(query: QueryState): string {
    let sql = 'SELECT ';

    if (query.distinct) {
      sql += 'DISTINCT ';
    }

    sql += this.compileColumns(query);
    sql += ` FROM ${this.wrapTable(this.requireTable(query))}`;

    if (query.joins.length > 0) {
      sql += ` ${this.compileJoins(query)}`;
    }

    if (query.wheres.length > 0) {
      sql += ` WHERE ${this.compileWheres(query)}`;
    }

    if (query.groups.length > 0) {
      sql += ` GROUP BY ${this.compileGroups(query)}`;
    }

    if (query.havings.length > 0) {
      sql += ` HAVING ${this.compileHavings(query)}`;
    }

    if (query.orders.length > 0) {
      sql += ` ORDER BY ${this.compileOrders(query)}`;
    }

    const limit = this.compileLimit(query);

    if (limit) {
      sql += ` ${limit}`;
    }

    const offset = this.compileOffset(query);

    if (offset) {
      sql += ` ${offset}`;
    }

    return sql;
  }

  /**
   * Compile the select column list.
   */
  compileColumns(query: QueryState): string {
    return query.columns.length > 0 ? this.columnize(query.columns) : '*';
  }

  /**
   * Compile the where clauses in declaration order, which is the order the
   * builder's `where` bindings are flattened in.
   */
  compileWheres(query: QueryState): string {
    return query.wheres
      .map((where, index) => {
        const boolean = index === 0 ? '' : ` ${where.boolean.toUpperCase()} `;
        const operator = this.normalizeOperator(where.operator);

        if (operator === 'raw') {
          return boolean + this.rawSql(where.column);
        }

        if (operator === 'exists' || operator === 'not exists') {
          return `${boolean}${operator.toUpperCase()} (${this.requireSubSelect(where.column, operator)})`;
        }

        if (where.compare === 'column') {
          return `${boolean}${this.wrap(where.column)} ${operator} ${this.wrap(this.requireColumn(where.value, operator))}`;
        }

        if (operator === 'in' || operator === 'not in') {
          const placeholders = this.listValue(where.value, operator)
            .map(() => '?')
            .join(', ');

          return `${boolean}${this.wrap(where.column)} ${operator.toUpperCase()} (${placeholders})`;
        }

        if (operator === 'between' || operator === 'not between') {
          if (this.listValue(where.value, operator).length !== 2) {
            throw new Error(`The "${operator}" operator expects exactly two values.`);
          }

          return `${boolean}${this.wrap(where.column)} ${operator.toUpperCase()} ? AND ?`;
        }

        if (operator === 'is null' || operator === 'is not null') {
          return `${boolean}${this.wrap(where.column)} ${operator.toUpperCase()}`;
        }

        return `${boolean}${this.wrap(where.column)} ${operator} ?`;
      })
      .join('');
  }

  /**
   * Compile the join clauses.
   */
  compileJoins(query: QueryState): string {
    return query.joins
      .map((join) => {
        if (join.second === undefined) {
          throw new Error(`Join on table [${join.table}] is missing the column it should be matched against.`);
        }

        const operator = this.normalizeOperator(join.operator ?? '=');

        return `${join.type.toUpperCase()} JOIN ${this.wrapTable(join.table)} ON ${this.wrap(join.first)} ${operator} ${this.wrap(join.second)}`;
      })
      .join(' ');
  }

  /**
   * Compile the group by clause.
   */
  compileGroups(query: QueryState): string {
    return this.columnize(query.groups);
  }

  /**
   * Compile the having clauses in declaration order, like the wheres.
   */
  compileHavings(query: QueryState): string {
    return query.havings
      .map((having, index) => {
        const boolean = index === 0 ? '' : ' AND ';

        return `${boolean}${this.wrap(having.column)} ${this.normalizeOperator(having.operator)} ?`;
      })
      .join('');
  }

  /**
   * Compile the order by clause.
   */
  compileOrders(query: QueryState): string {
    return query.orders.map((order) => `${this.wrap(order.column)} ${this.direction(order.direction)}`).join(', ');
  }

  /**
   * Compile the limit clause; empty when no limit is set.
   */
  compileLimit(query: QueryState): string {
    return query.limit === undefined ? '' : `LIMIT ${this.integer(query.limit, 'limit')}`;
  }

  /**
   * Compile the offset clause; empty when no offset is set.
   */
  compileOffset(query: QueryState): string {
    return query.offset === undefined ? '' : `OFFSET ${this.integer(query.offset, 'offset')}`;
  }

  /**
   * Compile a `FUNCTION(column) as aggregate` select expression.
   */
  compileAggregate(func: string, column: string): string {
    const normalized = func.trim().toLowerCase();

    if (!AGGREGATE_FUNCTIONS.has(normalized)) {
      throw new Error(`Unsupported aggregate function [${func}].`);
    }

    return `${normalized.toUpperCase()}(${this.wrap(column)}) as aggregate`;
  }

  // -------------------------------------------------------------------------
  // Data manipulating statements
  // -------------------------------------------------------------------------

  /**
   * Compile a single or bulk insert.
   */
  compileInsert(query: QueryState, records: Record<string, any>[]): string {
    if (records.length === 0) {
      throw new Error('Cannot compile an insert without any records.');
    }

    const columns = Object.keys(records[0]);

    if (columns.length === 0) {
      throw new Error('Cannot compile an insert for a record without any columns.');
    }

    const placeholders = records.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');

    return `INSERT INTO ${this.wrapTable(this.requireTable(query))} (${this.columnize(columns)}) VALUES ${placeholders}`;
  }

  /**
   * Compile an insert that hands the requested columns back to the caller.
   */
  compileInsertReturning(query: QueryState, records: Record<string, any>[], columns: string[]): string {
    if (!this.supportsReturning()) {
      throw new Error('This dialect does not support "RETURNING" clauses.');
    }

    const returning = columns.length > 0 ? columns : ['*'];

    return `${this.compileInsert(query, records)} RETURNING ${this.columnize(returning)}`;
  }

  /**
   * Compile the statement behind `insertGetId()`. Dialects that read the key
   * from the driver result insert plainly; `RETURNING` dialects ask for the key
   * column inside the statement.
   */
  compileInsertGetId(query: QueryState, record: Record<string, any>, sequence?: string): string {
    return this.compileInsert(query, [record]);
  }

  /**
   * Compile an update. The set assignments come before the where clauses, which
   * is the order the builder flattens their bindings in.
   */
  compileUpdate(query: QueryState, values: Record<string, any>): string {
    const entries = Object.entries(values);

    if (entries.length === 0) {
      throw new Error('Cannot compile an update without any columns to set.');
    }

    const sets = entries.map(([column]) => `${this.wrap(column)} = ?`).join(', ');

    let sql = `UPDATE ${this.wrapTable(this.requireTable(query))} SET ${sets}`;

    if (query.wheres.length > 0) {
      sql += ` WHERE ${this.compileWheres(query)}`;
    }

    return sql;
  }

  /**
   * Compile a delete.
   */
  compileDelete(query: QueryState): string {
    let sql = `DELETE FROM ${this.wrapTable(this.requireTable(query))}`;

    if (query.wheres.length > 0) {
      sql += ` WHERE ${this.compileWheres(query)}`;
    }

    return sql;
  }

  /**
   * Compile a truncate.
   */
  compileTruncate(query: QueryState): string {
    return `TRUNCATE TABLE ${this.wrapTable(this.requireTable(query))}`;
  }

  // -------------------------------------------------------------------------
  // Identifier wrapping
  // -------------------------------------------------------------------------

  /**
   * Wrap an identifier. `*`, `table.column`, `column as alias` and raw
   * expressions are understood; anything that is not a plain identifier is
   * rejected instead of being interpolated.
   */
  wrap(value: string | Expression): string {
    if (this.isExpression(value)) {
      return this.rawSql(value);
    }

    if (!this.isString(value)) {
      throw new Error(`Unsupported identifier [${String(value)}]: expected a column name or a raw expression.`);
    }

    if (value === '*') {
      return '*';
    }

    const [column, alias] = this.splitAlias(value);
    const wrapped = this.wrapSegments(column);

    return alias === undefined ? wrapped : `${wrapped} as ${this.wrapValue(alias)}`;
  }

  /**
   * Wrap a table name.
   */
  wrapTable(table: string): string {
    return this.wrap(table);
  }

  /**
   * Wrap a list of identifiers into a comma separated column list.
   */
  columnize(columns: (string | Expression)[]): string {
    return columns.map((column) => this.wrap(column)).join(', ');
  }

  // -------------------------------------------------------------------------
  // Raw SQL for display
  // -------------------------------------------------------------------------

  /**
   * Interpolate bindings into a statement for debugging.
   *
   * The result is display only and must never be executed: bindings are
   * rendered as literals the dialect would accept, so quotes, semicolons and
   * `?` characters inside a value cannot change the shape of the statement.
   */
  substituteBindings(sql: string, bindings: any[]): string {
    let out = '';
    let index = 0;
    let position = 0;

    while (index < sql.length) {
      const char = sql[index];

      if (char === "'" || char === '"' || char === '`') {
        const end = this.endOfQuoted(sql, index, char);

        out += sql.slice(index, end);
        index = end;
        continue;
      }

      if (char === '?' && position < bindings.length) {
        out += this.parameterize(bindings[position]);
        position += 1;
        index += 1;
        continue;
      }

      out += char;
      index += 1;
    }

    return out;
  }

  /**
   * Render a binding as a literal for `substituteBindings()`.
   */
  protected parameterize(value: any): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (typeof value === 'boolean') {
      return this.parameterizeBoolean(value);
    }

    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }

    if (value instanceof Date) {
      return this.quoteLiteral(value.toISOString());
    }

    if (this.isBinary(value)) {
      return `X'${this.bufferToHex(value)}'`;
    }

    return this.quoteLiteral(typeof value === 'string' ? value : String(value));
  }

  /**
   * How a boolean looks in this dialect. Dialects without a boolean literal
   * render it as `1` / `0`.
   */
  protected parameterizeBoolean(value: boolean): string {
    return value ? 'true' : 'false';
  }

  /**
   * Quote a string literal, doubling the quotes that appear inside it.
   */
  protected quoteLiteral(value: string): string {
    return `'${value.split("'").join("''")}'`;
  }

  /**
   * End index (exclusive) of a quoted literal or identifier starting at `start`.
   * Doubled quotes are escapes and stay inside the quoted region.
   */
  protected endOfQuoted(sql: string, start: number, quote: string): number {
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
   * Whether a binding is raw bytes, which every supported dialect can show as
   * a hex literal.
   */
  private isBinary(value: any): boolean {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
      return true;
    }

    return ArrayBuffer.isView(value) && !(value instanceof DataView);
  }

  private bufferToHex(value: any): string {
    const bytes = value instanceof DataView ? new Uint8Array(value.buffer) : new Uint8Array(value.buffer);

    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Whether a value is a raw SQL expression the grammar passes through. Checked
   * structurally so expressions survive cloning and module boundaries.
   */
  protected isExpression(value: unknown): value is Expression {
    return (
      typeof value === 'object' && value !== null && typeof (value as { getValue?: unknown }).getValue === 'function'
    );
  }

  /**
   * The raw SQL carried by an expression.
   */
  protected rawSql(value: string | Expression): string {
    return this.isExpression(value) ? value.getValue() : value;
  }

  /**
   * The sub-select an `exists` clause wraps. Only an expression the builder put
   * there qualifies: a bare string would skip every check the grammar makes.
   */
  protected requireSubSelect(value: string | Expression, operator: string): string {
    if (!this.isExpression(value)) {
      throw new Error(`The "${operator}" operator compiles a sub-select, got [${String(value)}].`);
    }

    return value.getValue();
  }

  /**
   * The other column of a `whereColumn` comparison, validated as an identifier
   * by wrapping it.
   */
  protected requireColumn(value: any, operator: string): string {
    if (!this.isString(value)) {
      throw new Error(`The "${operator}" column comparison expects a column name, got [${String(value)}].`);
    }

    return value;
  }

  /**
   * Identifier positions are typed as strings, but callers can hand over
   * anything at runtime; anything that is not a string is rejected rather than
   * coerced into the statement.
   */
  protected isString(value: unknown): value is string {
    return typeof value === 'string';
  }

  /**
   * Quote one identifier segment, escaping the quote glyph inside it.
   */
  protected wrapValue(value: string): string {
    if (!IDENTIFIER.test(value)) {
      throw new Error(
        `Unsupported identifier [${value}]. Pass raw SQL through the expression helpers ` +
          '(selectRaw, whereRaw) instead of as an identifier.'
      );
    }

    const glyph = this.wrapGlyph;

    return `${glyph}${value.split(glyph).join(glyph + glyph)}${glyph}`;
  }

  /**
   * Wrap a dotted identifier segment by segment; a `*` segment stays bare.
   */
  protected wrapSegments(value: string): string {
    return value
      .split('.')
      .map((segment) => (segment === '*' ? '*' : this.wrapValue(segment)))
      .join('.');
  }

  /**
   * Split `column as alias` into its halves.
   */
  protected splitAlias(value: string): [string, string | undefined] {
    const segments = value.split(/\s+as\s+/i);

    if (segments.length > 2) {
      throw new Error(`Unsupported identifier [${value}]: an alias may only be declared once.`);
    }

    return segments.length === 2 ? [segments[0], segments[1]] : [value, undefined];
  }

  /**
   * Validate an operator against the supported list and normalise its case.
   */
  protected normalizeOperator(operator: string): string {
    const normalized = String(operator ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

    if (!OPERATORS.has(normalized)) {
      throw new Error(`Unsupported operator [${operator}].`);
    }

    return normalized;
  }

  /**
   * Validate a sort direction.
   */
  protected direction(value: string): string {
    const normalized = String(value).trim().toLowerCase();

    if (normalized !== 'asc' && normalized !== 'desc') {
      throw new Error(`Unsupported order direction [${value}].`);
    }

    return normalized.toUpperCase();
  }

  /**
   * Read the list of values an `in` / `between` style operator expects.
   */
  protected listValue(value: any, operator: string): any[] {
    if (!Array.isArray(value)) {
      throw new Error(`The "${operator}" operator expects an array of values.`);
    }

    return value;
  }

  /**
   * Validate a limit or offset before it reaches the statement text.
   */
  protected integer(value: number, label: string): number {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid ${label} value [${value}].`);
    }

    return Math.trunc(value);
  }

  /**
   * The table a statement targets, with the error callers expect when the
   * builder never got one.
   */
  protected requireTable(query: QueryState): string {
    if (!query.table) {
      throw new Error('Cannot generate SQL without specifying a table');
    }

    return query.table;
  }
}

/**
 * Whether a where operator binds a list of values instead of a single one.
 */
export function isListOperator(operator: string): boolean {
  return LIST_OPERATORS.has(String(operator).trim().toLowerCase());
}
