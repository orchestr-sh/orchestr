/**
 * ForeignKeyDefinition
 *
 * Represents a foreign key constraint in a migration
 */

import { ForeignKeyDefinition as IForeignKeyDefinition } from '@/Database/Contracts/Schema';

export class ForeignKeyDefinition implements IForeignKeyDefinition {
  public columns: string[];
  public referencedColumns?: string[];
  public referencedTable?: string;
  public onDeleteAction?: 'cascade' | 'set null' | 'restrict' | 'no action';
  public onUpdateAction?: 'cascade' | 'set null' | 'restrict' | 'no action';
  public name?: string;

  constructor(columns: string | string[], name?: string) {
    this.columns = Array.isArray(columns) ? columns : [columns];
    this.name = name;
  }

  /**
   * Specify the referenced column(s)
   */
  references(columns: string | string[]): this {
    this.referencedColumns = Array.isArray(columns) ? columns : [columns];
    return this;
  }

  /**
   * Specify the referenced table
   */
  on(table: string): this {
    this.referencedTable = table;
    return this;
  }

  /**
   * Set the ON DELETE action
   */
  onDelete(action: 'cascade' | 'set null' | 'restrict' | 'no action'): this {
    this.onDeleteAction = action;
    return this;
  }

  /**
   * Set the ON UPDATE action
   */
  onUpdate(action: 'cascade' | 'set null' | 'restrict' | 'no action'): this {
    this.onUpdateAction = action;
    return this;
  }
}
