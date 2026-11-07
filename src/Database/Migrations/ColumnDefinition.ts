/**
 * ColumnDefinition
 *
 * Represents a column definition in a migration
 */

import { ColumnDefinition as IColumnDefinition } from '@/Database/Contracts/Schema';
import type { Blueprint } from './Blueprint';

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

  /**
   * The blueprint the column was declared on. Columns created directly with
   * `new ColumnDefinition(...)` have none, which only means there is no table
   * to attach an index or a modification to.
   */
  protected owningBlueprint?: Blueprint;

  constructor(name: string, type: string) {
    this.name = name;
    this.type = type;
  }

  /**
   * Tell the column which blueprint owns it, so modifiers that describe table
   * level objects (indexes, changes) can register themselves there.
   */
  setBlueprint(blueprint: Blueprint): this {
    this.owningBlueprint = blueprint;

    return this;
  }

  /**
   * The blueprint the column belongs to, when there is one.
   */
  getBlueprint(): Blueprint | undefined {
    return this.owningBlueprint;
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
  unique(indexName?: string): this {
    this.isUnique = true;
    this.owningBlueprint?.addIndex([this.name], 'unique', indexName ?? this.indexName);

    return this;
  }

  /**
   * Add an index
   */
  index(indexName?: string): this {
    this.indexName = indexName;
    this.owningBlueprint?.addIndex([this.name], 'index', indexName);

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

  /**
   * Mark the column as a modification of an existing column instead of a new
   * one, so `Schema::table()` redefines it rather than adding it.
   */
  change(): this {
    if (!this.owningBlueprint) {
      throw new Error(
        `Cannot change column [${this.name}]: the definition does not belong to a blueprint. Declare it inside a Schema::table() callback.`
      );
    }

    this.owningBlueprint.change(this);

    return this;
  }
}
