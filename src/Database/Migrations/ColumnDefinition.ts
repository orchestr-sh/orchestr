/**
 * ColumnDefinition
 *
 * Represents a column definition in a migration
 */

import { ColumnDefinition as IColumnDefinition } from '@/Database/Contracts/Schema';

export class ColumnDefinition implements IColumnDefinition {
  public name: string;
  public type: string;
  public length?: number;
  public precision?: number;
  public scale?: number;
  public isNullable: boolean = false;
  public defaultValue?: any;
  public isUnsigned: boolean = false;
  public isUnique: boolean = false;
  public isPrimary: boolean = false;
  public isAutoIncrement: boolean = false;
  public indexName?: string;
  public commentText?: string;
  public afterColumn?: string;
  public isFirst: boolean = false;
  public enumValues?: string[];

  constructor(name: string, type: string) {
    this.name = name;
    this.type = type;
  }

  /**
   * Allow NULL values
   */
  nullable(): this {
    this.isNullable = true;
    return this;
  }

  /**
   * Set a default value
   */
  default(value: any): this {
    this.defaultValue = value;
    return this;
  }

  /**
   * Mark as unsigned (for numeric types)
   */
  unsigned(): this {
    this.isUnsigned = true;
    return this;
  }

  /**
   * Add a unique constraint
   */
  unique(): this {
    this.isUnique = true;
    return this;
  }

  /**
   * Add an index
   */
  index(indexName?: string): this {
    this.indexName = indexName;
    return this;
  }

  /**
   * Set as primary key
   */
  primary(): this {
    this.isPrimary = true;
    return this;
  }

  /**
   * Add a comment
   */
  comment(comment: string): this {
    this.commentText = comment;
    return this;
  }

  /**
   * Place column after another column
   */
  after(column: string): this {
    this.afterColumn = column;
    return this;
  }

  /**
   * Place column first
   */
  first(): this {
    this.isFirst = true;
    return this;
  }
}
