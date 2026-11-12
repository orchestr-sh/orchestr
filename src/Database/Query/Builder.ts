/**
 * Query Builder
 *
 * Fluent query builder for constructing database queries.
 *
 * The builder owns query state and the fluent API only. Compiling that state
 * into SQL is the grammar's job, so a new driver means a new grammar, not a new
 * branch in here. Bindings are collected per clause (`select`, `join`, `where`,
 * `having`, `order`) and flattened in SQL order, which keeps raw select
 * expressions and raw where clauses bound in the order they appear in the
 * statement.
 */

import { DatabaseAdapter } from '@/Database/Contracts/DatabaseAdapter';
import {
  QueryBuilderInterface,
  SubSelect,
  WhereOperator,
  OrderDirection,
  JoinType,
  HavingClause,
  WhereClause,
  JoinClause,
  OrderByClause,
} from '@/Database/Contracts/QueryBuilderInterface';
import { Expression } from './Expression';
import { isListOperator, QueryGrammar, type QueryState } from './Grammars';

/**
 * The clause a binding belongs to. Flattened in this order so bindings always
 * line up with the placeholders their clause produced.
 */
export type BindingClause = 'select' | 'join' | 'where' | 'having' | 'order';

/**
 * Order the binding groups are flattened in: the order the clauses appear in
 * the compiled statement.
 */
const BINDING_ORDER: BindingClause[] = ['select', 'join', 'where', 'having', 'order'];

export class Builder<T = any> implements QueryBuilderInterface<T> {
  protected _columns: (string | Expression)[] = ['*'];
  protected _distinct: boolean = false;
  protected _table?: string;
  protected _wheres: WhereClause[] = [];
  protected _joins: JoinClause[] = [];
  protected _orders: OrderByClause[] = [];
  protected _groups: string[] = [];
  protected _havings: HavingClause[] = [];
  protected _limit?: number;
  protected _offset?: number;
  protected _returning?: string[];
  protected _bindings: Record<BindingClause, any[]> = { select: [], join: [], where: [], having: [], order: [] };

  constructor(
    protected adapter: DatabaseAdapter,
    protected grammar: QueryGrammar
  ) {}

  /**
   * Get the grammar that compiles this query
   */
  getGrammar(): QueryGrammar {
    return this.grammar;
  }

  /**
   * Set the columns to be selected
   *
   * A single string may list several columns (`select('id, name')`), which is
   * split so every column is quoted as its own identifier.
   */
  select(...columns: string[]): this {
    const parsed: (string | Expression)[] = [];

    for (const column of columns) {
      if (typeof column !== 'string') {
        parsed.push(column);
        continue;
      }

      for (const part of column.split(',')) {
        if (part.trim() !== '') {
          parsed.push(part.trim());
        }
      }
    }

    this._columns = parsed.length > 0 ? parsed : ['*'];
    return this;
  }

  /**
   * Add a raw select expression
   */
  selectRaw(sql: string, bindings: any[] = []): this {
    this._columns.push(new Expression(sql));
    this.addBindings(bindings, 'select');
    return this;
  }

  /**
   * Force the query to only return distinct results
   */
  distinct(): this {
    this._distinct = true;
    return this;
  }

  /**
   * Set the table which the query is targeting
   */
  from(table: string): this {
    this._table = table;
    return this;
  }

  /**
   * Add a basic where clause
   */
  where(column: string, operator?: WhereOperator | any, value?: any): this {
    return this.addWhere('and', column, operator, value, arguments.length);
  }

  /**
   * Add an "or where" clause
   */
  orWhere(column: string, operator?: WhereOperator | any, value?: any): this {
    return this.addWhere('or', column, operator, value, arguments.length);
  }

  /**
   * Add a where in clause
   */
  whereIn(column: string, values: any[], boolean: 'and' | 'or' = 'and'): this {
    return this.addWhereClause(boolean, column, 'in', values);
  }

  /**
   * Add a where not in clause
   */
  whereNotIn(column: string, values: any[], boolean: 'and' | 'or' = 'and'): this {
    return this.addWhereClause(boolean, column, 'not in', values);
  }

  /**
   * Add an "or where in" clause
   */
  orWhereIn(column: string, values: any[]): this {
    return this.whereIn(column, values, 'or');
  }

  /**
   * Add a where null clause
   */
  whereNull(column: string): this {
    this._wheres.push({
      column,
      operator: 'is null',
      value: null,
      boolean: 'and',
    });

    return this;
  }

  /**
   * Add a where not null clause
   */
  whereNotNull(column: string): this {
    this._wheres.push({
      column,
      operator: 'is not null',
      value: null,
      boolean: 'and',
    });

    return this;
  }

  /**
   * Add a where between clause
   */
  whereBetween(column: string, values: [any, any]): this {
    return this.addWhereClause('and', column, 'between', values);
  }

  /**
   * Add a raw where clause
   */
  whereRaw(sql: string, bindings: any[] = []): this {
    this._wheres.push({
      column: new Expression(sql),
      operator: 'raw',
      value: null,
      boolean: 'and',
    });

    this.addBindings(bindings, 'where');

    return this;
  }

  /**
   * Add a where clause comparing two columns
   *
   * The comparison side is never bound: both halves are identifiers the
   * grammar wraps, which is what lets a sub-select refer back to the row the
   * outer query is looking at.
   */
  whereColumn(first: string, operator?: any, second?: any, boolean: 'and' | 'or' = 'and'): this {
    if (arguments.length === 2) {
      second = operator;
      operator = '=';
    }

    this._wheres.push({
      column: first,
      operator: operator as string,
      value: second,
      boolean,
      compare: 'column',
    });

    return this;
  }

  /**
   * Add an "or where" clause comparing two columns
   */
  orWhereColumn(first: string, operator?: any, second?: any): this {
    if (arguments.length === 2) {
      return this.whereColumn(first, '=', operator, 'or');
    }

    return this.whereColumn(first, operator, second, 'or');
  }

  /**
   * Add a where clause keeping only rows a sub-select matches
   *
   * The sub-select's bindings join this clause's own place in the where list,
   * so the flattened bindings always line up with the compiled statement.
   */
  whereExists(sub: SubSelect, boolean: 'and' | 'or' = 'and', not: boolean = false): this {
    this._wheres.push({
      column: new Expression(sub.toSql()),
      operator: not ? 'not exists' : 'exists',
      value: null,
      boolean,
    });

    this.addBindings(sub.getBindings(), 'where');

    return this;
  }

  /**
   * Add a where clause keeping only rows a sub-select matches no result for
   */
  whereNotExists(sub: SubSelect, boolean: 'and' | 'or' = 'and'): this {
    return this.whereExists(sub, boolean, true);
  }

  /**
   * Add an "or where" clause for a sub-select existence check
   */
  orWhereExists(sub: SubSelect, not: boolean = false): this {
    return this.whereExists(sub, 'or', not);
  }

  /**
   * Add a where clause comparing a scalar sub-select with a value
   *
   * `where` cannot take an expression column, and the sub-select's bindings
   * have to precede the compared value; this keeps both orders straight.
   */
  whereSub(sub: SubSelect, operator: string, value: any, boolean: 'and' | 'or' = 'and'): this {
    this._wheres.push({
      column: new Expression(`(${sub.toSql()})`),
      operator,
      value,
      boolean,
    });

    this.addBindings(sub.getBindings(), 'where');

    if (value !== undefined) {
      this.addBinding(value, 'where');
    }

    return this;
  }

  /**
   * Add a join clause
   */
  join(table: string, first: string, operator: string = '=', second?: string): this {
    return this.addJoin('inner', table, first, operator, second);
  }

  /**
   * Add a left join clause
   */
  leftJoin(table: string, first: string, operator: string = '=', second?: string): this {
    return this.addJoin('left', table, first, operator, second);
  }

  /**
   * Add a right join clause
   */
  rightJoin(table: string, first: string, operator: string = '=', second?: string): this {
    return this.addJoin('right', table, first, operator, second);
  }

  /**
   * Add an order by clause
   */
  orderBy(column: string, direction: OrderDirection = 'asc'): this {
    this._orders.push({ column, direction });
    return this;
  }

  /**
   * Order by latest (descending created_at)
   */
  latest(column: string = 'created_at'): this {
    return this.orderBy(column, 'desc');
  }

  /**
   * Order by oldest (ascending created_at)
   */
  oldest(column: string = 'created_at'): this {
    return this.orderBy(column, 'asc');
  }

  /**
   * Add a group by clause
   */
  groupBy(...columns: string[]): this {
    this._groups.push(...columns);
    return this;
  }

  /**
   * Add a having clause
   */
  having(column: string, operator?: string, value?: any): this {
    if (arguments.length === 2) {
      value = operator;
      operator = '=';
    }

    this._havings.push({ column, operator: operator as string, value });

    if (value !== undefined) {
      this.addBinding(value, 'having');
    }

    return this;
  }

  /**
   * Set the limit
   */
  limit(value: number): this {
    this._limit = value;
    return this;
  }

  /**
   * Alias for limit
   */
  take(value: number): this {
    return this.limit(value);
  }

  /**
   * Set the offset
   */
  offset(value: number): this {
    this._offset = value;
    return this;
  }

  /**
   * Alias for offset
   */
  skip(value: number): this {
    return this.offset(value);
  }

  /**
   * Set the limit and offset for a given page
   * Laravel: Builder::forPage()
   */
  forPage(page: number, perPage: number = 15): this {
    const offset = (Math.max(page, 1) - 1) * perPage;

    return this.offset(offset).limit(perPage);
  }

  /**
   * Get the current order-by clauses of the query
   */
  getOrderings(): OrderByClause[] {
    return [...this._orders];
  }

  /**
   * Clear the query's orders, optionally ordering by one fresh column
   * Laravel: Builder::reorder()
   */
  reorder(column?: string, direction: OrderDirection = 'asc'): this {
    this._orders = [];

    if (column !== undefined && column !== null) {
      this.orderBy(column, direction);
    }

    return this;
  }

  /**
   * Get all records
   */
  async get(): Promise<T[]> {
    const sql = this.toSql();
    const results = await this.adapter.select<T>(sql, this.getBindings());
    return results;
  }

  /**
   * Get the first record
   */
  async first(): Promise<T | null> {
    const results = await this.limit(1).get();
    return results[0] || null;
  }

  /**
   * Find a record by ID
   */
  async find(id: any): Promise<T | null> {
    return this.where('id', '=', id).first();
  }

  /**
   * Get a single column's value
   */
  async value(column: string): Promise<any> {
    const result = await this.select(column).first();
    return result ? (result as any)[column] : null;
  }

  /**
   * Get an array of column values
   */
  async pluck(column: string): Promise<any[]> {
    const results = await this.select(column).get();
    return results.map((row) => (row as any)[column]);
  }

  /**
   * Determine if any rows exist
   */
  async exists(): Promise<boolean> {
    const count = await this.count();
    return count > 0;
  }

  /**
   * Get the count of records
   */
  async count(column: string = '*'): Promise<number> {
    return this.aggregate('COUNT', column);
  }

  /**
   * Get the maximum value of a column
   */
  async max(column: string): Promise<number | null> {
    return this.aggregate('MAX', column);
  }

  /**
   * Get the minimum value of a column
   */
  async min(column: string): Promise<number | null> {
    return this.aggregate('MIN', column);
  }

  /**
   * Get the average value of a column
   */
  async avg(column: string): Promise<number | null> {
    return this.aggregate('AVG', column);
  }

  /**
   * Get the sum of a column's values
   */
  async sum(column: string): Promise<number> {
    return this.aggregate('SUM', column) || 0;
  }

  /**
   * Execute an aggregate function
   *
   * The aggregate expression and the bindings it joins are transient, so the
   * query the caller built is left exactly as it was.
   */
  protected async aggregate(func: string, column: string): Promise<any> {
    const previousColumns = [...this._columns];
    const previousSelectBindings = this._bindings.select.slice();

    this.selectRaw(this.grammar.compileAggregate(func, column));

    const result = await this.first();

    this._columns = previousColumns;
    this.setBindings(previousSelectBindings, 'select');

    return result ? (result as any)['aggregate'] : null;
  }

  /**
   * Insert a new record
   */
  insert(values: Record<string, any> | Record<string, any>[]): Promise<boolean> & {
    returning(columns?: string | string[], key?: string): Promise<any | any[]>;
  } {
    const returningFn = (columns?: string | string[], key?: string) => this.insertReturning(values, columns, key);
    const exec = () => this.executeInsert(values);
    const chain: any = {
      returning: returningFn,
      then: (onfulfilled: any, onrejected: any) => exec().then(onfulfilled, onrejected),
      catch: (onrejected: any) => exec().catch(onrejected),
      finally: (onfinally: any) => exec().finally(onfinally),
    };
    return chain as Promise<boolean> & { returning: typeof returningFn };
  }

  /**
   * Run a plain insert, with no rows handed back
   */
  protected async executeInsert(values: Record<string, any> | Record<string, any>[]): Promise<boolean> {
    if (!this._table) {
      throw new Error('Cannot insert without specifying a table');
    }

    const records = Array.isArray(values) ? values : [values];
    if (records.length === 0) {
      return true;
    }

    const sql = this.grammar.compileInsert(this.toQueryState(), records);
    await this.adapter.insert(sql, this.insertBindings(records));
    return true;
  }

  /**
   * Specify returning columns for insert/update operations
   */
  returning(columns?: string | string[]): this {
    if (!columns) {
      this._returning = ['*'];
    } else if (Array.isArray(columns)) {
      this._returning = columns;
    } else {
      this._returning = [columns];
    }
    return this;
  }

  /**
   * Insert and return selected columns
   * - Single insert: returns one row (object)
   * - Bulk insert: returns array of rows
   * - Drivers without RETURNING (e.g., MySQL) need the key column to read the row back
   */
  async insertReturning(
    values: Record<string, any> | Record<string, any>[],
    columns?: string | string[],
    key?: string
  ): Promise<any | any[]> {
    if (!this._table) {
      throw new Error('Cannot insert without specifying a table');
    }

    const records = Array.isArray(values) ? values : [values];
    if (records.length === 0) {
      return Array.isArray(values) ? [] : null;
    }

    const returning = this.resolveReturningColumns(columns);

    if (this.grammar.supportsReturning()) {
      try {
        const sql = this.grammar.compileInsertReturning(this.toQueryState(), records, returning);
        const rows = await this.adapter.select<any>(sql, this.insertBindings(records));

        this._returning = undefined;

        return records.length === 1 ? (rows[0] ?? null) : rows;
      } catch (error) {
        // A RETURNING-capable driver that still reports a generated key can
        // recover by inserting plainly and reading the row back.
        if (this.grammar.usesLastInsertId()) {
          return await this.insertAndReadBack(records, returning, key);
        }

        throw error;
      }
    }

    return await this.insertAndReadBack(records, returning, key);
  }

  /**
   * Insert without a RETURNING clause and read a single row back by its
   * generated key. Used for MySQL and for SQLite builds older than 3.35.
   */
  protected async insertAndReadBack(records: Record<string, any>[], returning: string[], key?: string): Promise<any> {
    const sql = this.grammar.compileInsert(this.toQueryState(), records);
    const generatedKey = await this.adapter.insert(sql, this.insertBindings(records));

    this._returning = undefined;

    if (records.length > 1) {
      throw new Error(
        'returning() is not supported for bulk inserts on this driver. Insert succeeded without returning rows.'
      );
    }

    if (!key) {
      throw new Error(
        'Cannot return the inserted row: this driver has no RETURNING support and no key column was configured. ' +
          'Pass the generated key column, e.g. insert(values).returning(["id"], "id") or insertGetId(values).'
      );
    }

    // The driver handed back no generated key, so there is nothing to look the
    // row up by; report the insert as done without a row rather than guessing.
    if (generatedKey === undefined || generatedKey === null) {
      return null;
    }

    const row = await new Builder<any>(this.adapter, this.grammar)
      .from(this._table as string)
      .select(...returning)
      .where(key, '=', generatedKey)
      .first();

    return row ?? null;
  }

  /**
   * Resolve the columns a returning() call asks for, defaulting to `*`.
   */
  protected resolveReturningColumns(columns?: string | string[]): string[] {
    if (columns === undefined) {
      return this._returning && this._returning.length > 0 ? this._returning : ['*'];
    }

    return Array.isArray(columns) ? columns : [columns];
  }

  /**
   * Insert a new record and get the ID
   *
   * The way the key is read back is a dialect detail: SQLite uses
   * `lastInsertRowid`, MySQL uses `insertId` (both from the driver result),
   * PostgreSQL asks for it with `RETURNING`. `sequence` names the key column so
   * no column name is assumed.
   */
  async insertGetId(values: Record<string, any>, sequence?: string): Promise<any> {
    if (!this._table) {
      throw new Error('Cannot insert without specifying a table');
    }

    if (Array.isArray(values)) {
      throw new Error('Cannot get the insert ID for more than one record');
    }

    const columns = Object.keys(values);

    if (columns.length === 0) {
      throw new Error('Cannot insert a record without any columns');
    }

    const sql = this.grammar.compileInsertGetId(this.toQueryState(), values, sequence);
    const bindings = columns.map((column) => values[column]);

    if (this.grammar.usesLastInsertId()) {
      return await this.adapter.insert(sql, bindings);
    }

    const rows = await this.adapter.select<any>(sql, bindings);
    const key = this.grammar.generatedKeyColumn(this.toQueryState(), sequence);

    return rows.length > 0 ? (rows[0][key] ?? null) : null;
  }

  /**
   * Update records
   *
   * The set bindings come first, then the where bindings: the order the
   * compiled statement puts its placeholders in.
   */
  async update(values: Record<string, any>): Promise<number> {
    if (!this._table) {
      throw new Error('Cannot update without specifying a table');
    }

    const sql = this.grammar.compileUpdate(this.toQueryState(), values);
    const bindings = [...Object.values(values), ...this.getBindingsFor(['where'])];

    return await this.adapter.update(sql, bindings);
  }

  /**
   * Delete records
   */
  async delete(): Promise<number> {
    if (!this._table) {
      throw new Error('Cannot delete without specifying a table');
    }

    const sql = this.grammar.compileDelete(this.toQueryState());

    return await this.adapter.delete(sql, this.getBindingsFor(['where']));
  }

  /**
   * Truncate the table
   */
  async truncate(): Promise<void> {
    if (!this._table) {
      throw new Error('Cannot truncate without specifying a table');
    }

    await this.adapter.query(this.grammar.compileTruncate(this.toQueryState()));
  }

  /**
   * Get the SQL query string
   */
  toSql(): string {
    return this.grammar.compileSelect(this.toQueryState());
  }

  /**
   * Get the query with its bindings interpolated in, for debugging only.
   *
   * The interpolated statement is never executed: `toSql()` plus
   * `getBindings()` remain the parameterized pair passed to the driver.
   */
  toRawSql(): string {
    return this.grammar.substituteBindings(this.toSql(), this.getBindings());
  }

  /**
   * Get the bindings for the query, flattened in SQL clause order
   */
  getBindings(): any[] {
    return this.getBindingsFor(BINDING_ORDER);
  }

  /**
   * Get the bindings of the given clauses, each in declaration order
   */
  protected getBindingsFor(clauses: BindingClause[]): any[] {
    return clauses.flatMap((clause) => this._bindings[clause]);
  }

  /**
   * Get the bindings grouped by clause. The groups are what keeps raw select,
   * where and having bindings in the order the compiled statement needs them.
   */
  getRawBindings(): Record<BindingClause, any[]> {
    return {
      select: [...this._bindings.select],
      join: [...this._bindings.join],
      where: [...this._bindings.where],
      having: [...this._bindings.having],
      order: [...this._bindings.order],
    };
  }

  /**
   * Replace the bindings of a single clause
   */
  protected setBindings(values: any[], clause: BindingClause): void {
    this._bindings[clause] = [...values];
  }

  /**
   * Add a binding for a clause. Callers declare which clause a value belongs to
   * so the flattened order always matches the compiled statement.
   */
  protected addBinding(value: any, clause: BindingClause): void {
    this._bindings[clause].push(value);
  }

  /**
   * Add several bindings for a clause, preserving their order
   */
  protected addBindings(values: any[], clause: BindingClause): void {
    this._bindings[clause].push(...values);
  }

  /**
   * The state the grammar compiles from. Column and binding arrays are handed
   * over by reference because grammars only read them.
   */
  protected toQueryState(): QueryState {
    return {
      table: this._table,
      columns: this._columns,
      distinct: this._distinct,
      joins: this._joins,
      wheres: this._wheres,
      groups: this._groups,
      havings: this._havings,
      orders: this._orders,
      limit: this._limit,
      offset: this._offset,
      returning: this._returning,
    };
  }

  /**
   * Add a where clause and the bindings its operator expects
   */
  protected addWhereClause(boolean: 'and' | 'or', column: string, operator: string, value?: any): this {
    this._wheres.push({ column, operator, value, boolean });

    if (isListOperator(operator)) {
      this.addBindings(this.listValues(value, operator), 'where');
    } else if (value !== undefined && !this.isNullOperator(operator)) {
      this.addBinding(value, 'where');
    }

    return this;
  }

  /**
   * Normalise the `where(column, value)` and null-check shorthand forms into a
   * clause plus the bindings that clause needs.
   */
  protected addWhere(boolean: 'and' | 'or', column: string, operator: any, value: any, argCount: number): this {
    // Handle where(column, value) syntax
    if (argCount === 2) {
      value = operator;
      operator = '=';
    }

    if (this.isNullOperator(operator)) {
      this._wheres.push({ column, operator, value: null, boolean });
      return this;
    }

    return this.addWhereClause(boolean, column, operator, value);
  }

  /**
   * Whether an operator checks for NULL instead of binding a value
   */
  protected isNullOperator(operator: any): boolean {
    return operator === 'is null' || operator === 'is not null';
  }

  /**
   * The values a list operator (`in`, `between`) binds
   */
  protected listValues(value: any, operator: string): any[] {
    if (!Array.isArray(value)) {
      throw new Error(`The "${operator}" operator expects an array of values.`);
    }

    return value;
  }

  /**
   * Add a join clause
   */
  protected addJoin(type: JoinType, table: string, first: string, operator: string, second?: string): this {
    this._joins.push({ type, table, first, operator, second });
    return this;
  }

  /**
   * The bindings an insert of these records needs, column by column
   */
  protected insertBindings(records: Record<string, any>[]): any[] {
    const columns = Object.keys(records[0]);
    return records.flatMap((record) => columns.map((column) => record[column]));
  }

  /**
   * Clone the query builder
   */
  clone(): Builder<T> {
    const cloned = new Builder<T>(this.adapter, this.grammar);
    this.copyStateInto(cloned);
    return cloned;
  }

  /**
   * Copy this builder's state into another one. Subclasses use it to clone
   * without reaching into each other's private fields.
   */
  protected copyStateInto(cloned: Builder<T>): void {
    cloned._columns = [...this._columns];
    cloned._distinct = this._distinct;
    cloned._table = this._table;
    cloned._wheres = [...this._wheres];
    cloned._joins = [...this._joins];
    cloned._orders = [...this._orders];
    cloned._groups = [...this._groups];
    cloned._havings = [...this._havings];
    cloned._limit = this._limit;
    cloned._offset = this._offset;
    cloned._returning = this._returning ? [...this._returning] : undefined;
    cloned._bindings = this.getRawBindings();
  }
}
