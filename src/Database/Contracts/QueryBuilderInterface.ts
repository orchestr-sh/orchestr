/**
 * QueryBuilder Interface
 *
 * Defines the contract for query builders
 */

export type WhereOperator =
  | '='
  | '!='
  | '<>'
  | '>'
  | '>='
  | '<'
  | '<='
  | 'like'
  | 'not like'
  | 'in'
  | 'not in'
  | 'between'
  | 'not between';

export type OrderDirection = 'asc' | 'desc';

export type JoinType = 'inner' | 'left' | 'right' | 'cross';

export interface WhereClause {
  column: string;
  operator: WhereOperator | string;
  value: any;
  boolean: 'and' | 'or';
}

export interface JoinClause {
  type: JoinType;
  table: string;
  first: string;
  operator?: string;
  second?: string;
}

export interface OrderByClause {
  column: string;
  direction: OrderDirection;
}

export interface QueryBuilderInterface<T = any> {
  /**
   * Set the columns to be selected
   */
  select(...columns: string[]): this;

  /**
   * Add a raw select expression
   */
  selectRaw(sql: string, bindings?: any[]): this;

  /**
   * Force the query to only return distinct results
   */
  distinct(): this;

  /**
   * Set the table which the query is targeting
   */
  from(table: string): this;

  /**
   * Add a basic where clause
   */
  where(column: string, operator?: WhereOperator | any, value?: any): this;

  /**
   * Add an "or where" clause
   */
  orWhere(column: string, operator?: WhereOperator | any, value?: any): this;

  /**
   * Add a where in clause
   */
  whereIn(column: string, values: any[]): this;

  /**
   * Add a where not in clause
   */
  whereNotIn(column: string, values: any[]): this;

  /**
   * Add a where null clause
   */
  whereNull(column: string): this;

  /**
   * Add a where not null clause
   */
  whereNotNull(column: string): this;

  /**
   * Add a where between clause
   */
  whereBetween(column: string, values: [any, any]): this;

  /**
   * Add a raw where clause
   */
  whereRaw(sql: string, bindings?: any[]): this;

  /**
   * Add a join clause
   */
  join(table: string, first: string, operator?: string, second?: string): this;

  /**
   * Add a left join clause
   */
  leftJoin(table: string, first: string, operator?: string, second?: string): this;

  /**
   * Add a right join clause
   */
  rightJoin(table: string, first: string, operator?: string, second?: string): this;

  /**
   * Add an order by clause
   */
  orderBy(column: string, direction?: OrderDirection): this;

  /**
   * Order by latest (descending created_at)
   */
  latest(column?: string): this;

  /**
   * Order by oldest (ascending created_at)
   */
  oldest(column?: string): this;

  /**
   * Add a group by clause
   */
  groupBy(...columns: string[]): this;

  /**
   * Add a having clause
   */
  having(column: string, operator?: string, value?: any): this;

  /**
   * Set the limit
   */
  limit(value: number): this;

  /**
   * Alias for limit
   */
  take(value: number): this;

  /**
   * Set the offset
   */
  offset(value: number): this;

  /**
   * Alias for offset
   */
  skip(value: number): this;

  /**
   * Get all records
   */
  get(): Promise<T[]>;

  /**
   * Get the first record
   */
  first(): Promise<T | null>;

  /**
   * Find a record by ID
   */
  find(id: any): Promise<T | null>;

  /**
   * Get a single column's value
   */
  value(column: string): Promise<any>;

  /**
   * Get an array of column values
   */
  pluck(column: string): Promise<any[]>;

  /**
   * Determine if any rows exist
   */
  exists(): Promise<boolean>;

  /**
   * Get the count of records
   */
  count(column?: string): Promise<number>;

  /**
   * Get the maximum value of a column
   */
  max(column: string): Promise<number | null>;

  /**
   * Get the minimum value of a column
   */
  min(column: string): Promise<number | null>;

  /**
   * Get the average value of a column
   */
  avg(column: string): Promise<number | null>;

  /**
   * Get the sum of a column's values
   */
  sum(column: string): Promise<number>;

  /**
   * Insert a new record
   */
  insert(
    values: Record<string, any> | Record<string, any>[]
  ): Promise<boolean> & { returning(columns?: string | string[]): Promise<any | any[]> };

  /**
   * Specify returning columns for insert/update operations
   */
  returning(columns?: string | string[]): this;

  /**
   * Insert and return selected columns (object for single, array for bulk)
   */
  insertReturning(
    values: Record<string, any> | Record<string, any>[],
    columns?: string | string[]
  ): Promise<any | any[]>;

  /**
   * Insert a new record and get the ID
   */
  insertGetId(values: Record<string, any>, sequence?: string): Promise<any>;

  /**
   * Update records
   */
  update(values: Record<string, any>): Promise<number>;

  /**
   * Delete records
   */
  delete(): Promise<number>;

  /**
   * Truncate the table
   */
  truncate(): Promise<void>;

  /**
   * Get the SQL query string
   */
  toSql(): string;

  /**
   * Get the bindings for the query
   */
  getBindings(): any[];
}
