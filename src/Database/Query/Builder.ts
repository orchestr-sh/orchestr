/**
 * Query Builder
 *
 * Fluent query builder for constructing database queries
 */

import { DatabaseAdapter } from '../Contracts/DatabaseAdapter';
import {
  QueryBuilderInterface,
  WhereOperator,
  OrderDirection,
  JoinType,
  WhereClause,
  JoinClause,
  OrderByClause,
} from '../Contracts/QueryBuilderInterface';
import { Expression } from './Expression';

export class Builder<T = any> implements QueryBuilderInterface<T> {
  protected _columns: string[] = ['*'];
  protected _distinct: boolean = false;
  protected _table?: string;
  protected _wheres: WhereClause[] = [];
  protected _joins: JoinClause[] = [];
  protected _orders: OrderByClause[] = [];
  protected _groups: string[] = [];
  protected _havings: any[] = [];
  protected _limit?: number;
  protected _offset?: number;
  protected _bindings: any[] = [];

  constructor(protected adapter: DatabaseAdapter) {}

  /**
   * Set the columns to be selected
   */
  select(...columns: string[]): this {
    this._columns = columns.length > 0 ? columns : ['*'];
    return this;
  }

  /**
   * Add a raw select expression
   */
  selectRaw(sql: string, bindings: any[] = []): this {
    this._columns.push(new Expression(sql) as any);
    this._bindings.push(...bindings);
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
    // Handle where(column, value) syntax
    if (arguments.length === 2) {
      value = operator;
      operator = '=';
    }

    this._wheres.push({
      column,
      operator: operator as WhereOperator,
      value,
      boolean: 'and',
    });

    if (value !== undefined && value !== null) {
      this._bindings.push(value);
    }

    return this;
  }

  /**
   * Add an "or where" clause
   */
  orWhere(column: string, operator?: WhereOperator | any, value?: any): this {
    if (arguments.length === 2) {
      value = operator;
      operator = '=';
    }

    this._wheres.push({
      column,
      operator: operator as WhereOperator,
      value,
      boolean: 'or',
    });

    if (value !== undefined && value !== null) {
      this._bindings.push(value);
    }

    return this;
  }

  /**
   * Add a where in clause
   */
  whereIn(column: string, values: any[]): this {
    this._wheres.push({
      column,
      operator: 'in',
      value: values,
      boolean: 'and',
    });

    this._bindings.push(...values);
    return this;
  }

  /**
   * Add a where not in clause
   */
  whereNotIn(column: string, values: any[]): this {
    this._wheres.push({
      column,
      operator: 'not in',
      value: values,
      boolean: 'and',
    });

    this._bindings.push(...values);
    return this;
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
    this._wheres.push({
      column,
      operator: 'between',
      value: values,
      boolean: 'and',
    });

    this._bindings.push(...values);
    return this;
  }

  /**
   * Add a raw where clause
   */
  whereRaw(sql: string, bindings: any[] = []): this {
    this._wheres.push({
      column: new Expression(sql) as any,
      operator: 'raw',
      value: null,
      boolean: 'and',
    });

    this._bindings.push(...bindings);
    return this;
  }

  /**
   * Add a join clause
   */
  join(table: string, first: string, operator: string = '=', second?: string): this {
    this._joins.push({
      type: 'inner',
      table,
      first,
      operator,
      second,
    });

    return this;
  }

  /**
   * Add a left join clause
   */
  leftJoin(table: string, first: string, operator: string = '=', second?: string): this {
    this._joins.push({
      type: 'left',
      table,
      first,
      operator,
      second,
    });

    return this;
  }

  /**
   * Add a right join clause
   */
  rightJoin(table: string, first: string, operator: string = '=', second?: string): this {
    this._joins.push({
      type: 'right',
      table,
      first,
      operator,
      second,
    });

    return this;
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

    this._havings.push({ column, operator, value });

    if (value !== undefined && value !== null) {
      this._bindings.push(value);
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
   */
  protected async aggregate(func: string, column: string): Promise<any> {
    const previousColumns = this._columns;
    const previousBindings = this._bindings.slice();

    this.selectRaw(`${func}(${column}) as aggregate`);

    const result = await this.first();

    this._columns = previousColumns;
    this._bindings = previousBindings;

    return result ? (result as any)['aggregate'] : null;
  }

  /**
   * Insert a new record
   */
  async insert(values: Record<string, any> | Record<string, any>[]): Promise<boolean> {
    if (!this._table) {
      throw new Error('Cannot insert without specifying a table');
    }

    const records = Array.isArray(values) ? values : [values];

    if (records.length === 0) {
      return true;
    }

    const columns = Object.keys(records[0]);
    const placeholders = records.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');

    const bindings = records.flatMap((record) => columns.map((col) => record[col]));

    const sql = `INSERT INTO ${this._table} (${columns.join(', ')}) VALUES ${placeholders}`;

    await this.adapter.insert(sql, bindings);
    return true;
  }

  /**
   * Insert a new record and get the ID
   */
  async insertGetId(values: Record<string, any>, sequence?: string): Promise<any> {
    if (!this._table) {
      throw new Error('Cannot insert without specifying a table');
    }

    const columns = Object.keys(values);
    const placeholders = columns.map(() => '?').join(', ');
    const bindings = columns.map((col) => values[col]);

    const sql = `INSERT INTO ${this._table} (${columns.join(', ')}) VALUES (${placeholders})`;

    return await this.adapter.insert(sql, bindings);
  }

  /**
   * Update records
   */
  async update(values: Record<string, any>): Promise<number> {
    if (!this._table) {
      throw new Error('Cannot update without specifying a table');
    }

    const sets = Object.keys(values)
      .map((key) => `${key} = ?`)
      .join(', ');

    const bindings = [...Object.values(values), ...this.getBindings()];

    let sql = `UPDATE ${this._table} SET ${sets}`;

    if (this._wheres.length > 0) {
      sql += ' WHERE ' + this.compileWheres();
    }

    return await this.adapter.update(sql, bindings);
  }

  /**
   * Delete records
   */
  async delete(): Promise<number> {
    if (!this._table) {
      throw new Error('Cannot delete without specifying a table');
    }

    let sql = `DELETE FROM ${this._table}`;

    if (this._wheres.length > 0) {
      sql += ' WHERE ' + this.compileWheres();
    }

    return await this.adapter.delete(sql, this.getBindings());
  }

  /**
   * Truncate the table
   */
  async truncate(): Promise<void> {
    if (!this._table) {
      throw new Error('Cannot truncate without specifying a table');
    }

    const sql = `TRUNCATE TABLE ${this._table}`;
    await this.adapter.query(sql);
  }

  /**
   * Get the SQL query string
   */
  toSql(): string {
    if (!this._table) {
      throw new Error('Cannot generate SQL without specifying a table');
    }

    let sql = 'SELECT ';

    if (this._distinct) {
      sql += 'DISTINCT ';
    }

    sql += this.compileColumns();
    sql += ` FROM ${this._table}`;

    if (this._joins.length > 0) {
      sql += ' ' + this.compileJoins();
    }

    if (this._wheres.length > 0) {
      sql += ' WHERE ' + this.compileWheres();
    }

    if (this._groups.length > 0) {
      sql += ' GROUP BY ' + this._groups.join(', ');
    }

    if (this._havings.length > 0) {
      sql += ' HAVING ' + this.compileHavings();
    }

    if (this._orders.length > 0) {
      sql += ' ORDER BY ' + this.compileOrders();
    }

    if (this._limit !== undefined) {
      sql += ` LIMIT ${this._limit}`;
    }

    if (this._offset !== undefined) {
      sql += ` OFFSET ${this._offset}`;
    }

    return sql;
  }

  /**
   * Compile the columns
   */
  protected compileColumns(): string {
    return this._columns
      .map((col) => (typeof col === 'object' && col && 'getValue' in col ? (col as Expression).getValue() : col))
      .join(', ');
  }

  /**
   * Compile the where clauses
   */
  protected compileWheres(): string {
    return this._wheres
      .map((where, index) => {
        const boolean = index === 0 ? '' : ` ${where.boolean.toUpperCase()} `;

        if (where.operator === 'raw') {
          return (
            boolean +
            (typeof where.column === 'object' && where.column && 'getValue' in where.column
              ? (where.column as Expression).getValue()
              : where.column)
          );
        }

        if (where.operator === 'in' || where.operator === 'not in') {
          const placeholders = (where.value as any[]).map(() => '?').join(', ');
          return `${boolean}${where.column} ${where.operator.toUpperCase()} (${placeholders})`;
        }

        if (where.operator === 'between') {
          return `${boolean}${where.column} BETWEEN ? AND ?`;
        }

        if (where.operator === 'is null' || where.operator === 'is not null') {
          return `${boolean}${where.column} ${where.operator.toUpperCase()}`;
        }

        return `${boolean}${where.column} ${where.operator} ?`;
      })
      .join('');
  }

  /**
   * Compile the join clauses
   */
  protected compileJoins(): string {
    return this._joins
      .map((join) => {
        const type = join.type.toUpperCase();
        return `${type} JOIN ${join.table} ON ${join.first} ${join.operator} ${join.second}`;
      })
      .join(' ');
  }

  /**
   * Compile the order by clauses
   */
  protected compileOrders(): string {
    return this._orders.map((order) => `${order.column} ${order.direction.toUpperCase()}`).join(', ');
  }

  /**
   * Compile the having clauses
   */
  protected compileHavings(): string {
    return this._havings
      .map((having, index) => {
        const boolean = index === 0 ? '' : ' AND ';
        return `${boolean}${having.column} ${having.operator} ?`;
      })
      .join('');
  }

  /**
   * Get the bindings for the query
   */
  getBindings(): any[] {
    return this._bindings;
  }

  /**
   * Clone the query builder
   */
  clone(): Builder<T> {
    const cloned = new Builder<T>(this.adapter);
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
    cloned._bindings = [...this._bindings];
    return cloned;
  }
}
