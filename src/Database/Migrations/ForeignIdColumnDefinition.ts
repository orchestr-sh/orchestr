/**
 * ForeignIdColumnDefinition
 *
 * The column returned by `Blueprint.foreignId()` and `Blueprint.foreignIdFor()`.
 *
 * It is an ordinary unsigned big integer until `constrained()` is called, at
 * which point the matching foreign key constraint is registered on the
 * blueprint. The referential actions (`cascadeOnDelete()` and friends) forward
 * to that constraint, so a definition reads as one fluent chain:
 *
 * ```ts
 * table.foreignId('user_id').constrained().cascadeOnDelete();
 * ```
 */

import type { ForeignIdColumnDefinition as IForeignIdColumnDefinition } from '@/Database/Contracts/Schema';
import type { Blueprint } from './Blueprint';
import type { ForeignKeyDefinition } from './ForeignKeyDefinition';
import { ColumnDefinition } from './ColumnDefinition';
import { pluralize } from './Naming';

export type ForeignKeyAction = 'cascade' | 'set null' | 'restrict' | 'no action';

export class ForeignIdColumnDefinition extends ColumnDefinition implements IForeignIdColumnDefinition {
  /**
   * The constraint `constrained()` registered, if any.
   */
  public foreignKey?: ForeignKeyDefinition;

  constructor(name: string) {
    super(name, 'bigInteger');

    this.isUnsigned = true;
  }

  /**
   * Attach a foreign key to this column.
   *
   * Without arguments the reference is derived from the column name:
   * `user_id` points at the `id` column of the `users` table.
   */
  constrained(referencedTable?: string, referencedColumn: string = 'id'): this {
    const blueprint = this.owner();
    const table = referencedTable ?? this.referencedTableName();

    this.foreignKey = blueprint.foreign(this.name).references(referencedColumn).on(table);

    return this;
  }

  /**
   * The constraint this definition registered, throwing when there is none.
   */
  protected constraint(): ForeignKeyDefinition {
    if (!this.foreignKey) {
      throw new Error(
        `Cannot set a referential action on [${this.name}] before calling constrained() on the foreign key column.`
      );
    }

    return this.foreignKey;
  }

  /**
   * Set the ON DELETE action.
   */
  onDelete(action: ForeignKeyAction): this {
    this.constraint().onDelete(action);

    return this;
  }

  /**
   * Set the ON UPDATE action.
   */
  onUpdate(action: ForeignKeyAction): this {
    this.constraint().onUpdate(action);

    return this;
  }

  /**
   * Delete dependent rows with their parent.
   */
  cascadeOnDelete(): this {
    return this.onDelete('cascade');
  }

  /**
   * Update dependent rows with their parent.
   */
  cascadeOnUpdate(): this {
    return this.onUpdate('cascade');
  }

  /**
   * Null out dependent rows when the parent is deleted.
   */
  nullOnDelete(): this {
    return this.onDelete('set null');
  }

  /**
   * Null out dependent rows when the parent is updated.
   */
  nullOnUpdate(): this {
    return this.onUpdate('set null');
  }

  /**
   * Block deleting a row that is still referenced.
   */
  restrictOnDelete(): this {
    return this.onDelete('restrict');
  }

  /**
   * Block updating a row that is still referenced.
   */
  restrictOnUpdate(): this {
    return this.onUpdate('restrict');
  }

  /**
   * Keep the database's default behaviour for deletes.
   */
  noActionOnDelete(): this {
    return this.onDelete('no action');
  }

  /**
   * Keep the database's default behaviour for updates.
   */
  noActionOnUpdate(): this {
    return this.onUpdate('no action');
  }

  /**
   * The table the column points at, derived by pluralising the column name with
   * its `_id` suffix removed: `user_id` becomes `users`, `author_person_id`
   * becomes `author_people`.
   */
  protected referencedTableName(): string {
    const stem = this.name.replace(/_id$/, '');

    return pluralize(stem);
  }

  /**
   * The blueprint the column belongs to. `constrained()` needs a table to
   * register the constraint against, so a detached definition fails loudly.
   */
  private owner(): Blueprint {
    const blueprint = this.getBlueprint();

    if (!blueprint) {
      throw new Error(
        `Cannot constrain column [${this.name}]: the definition does not belong to a blueprint. Declare it inside a Schema::create() or Schema::table() callback.`
      );
    }

    return blueprint;
  }
}
