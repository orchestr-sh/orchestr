/**
 * MorphedByMany Relationship
 *
 * Represents the inverse of a polymorphic many-to-many relationship
 * Example: Tag has many Posts (where Post morphs to many Tags)
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleBuilder } from '@/Database/Ensemble/EnsembleBuilder';
import { MorphToMany } from './MorphToMany';
import { MorphMap } from './MorphMap';

export class MorphedByMany<TRelated extends Ensemble, TParent extends Ensemble> extends MorphToMany<TRelated, TParent> {
  /**
   * Create a new morphed by many relationship instance
   */
  constructor(
    query: EnsembleBuilder<TRelated>,
    parent: TParent,
    name: string,
    table: string,
    foreignPivotKey: string,
    relatedPivotKey: string,
    morphType: string,
    parentKey: string,
    relatedKey: string,
    relationName?: string
  ) {
    // Call parent with inverse flag set to true
    super(
      query,
      parent,
      name,
      table,
      foreignPivotKey,
      relatedPivotKey,
      morphType,
      parentKey,
      relatedKey,
      relationName,
      true // inverse
    );

    // Set the morph class based on the related model
    this.morphClass = this.getMorphClassForRelated();
  }

  /**
   * Get the morph class for the related model
   */
  protected getMorphClassForRelated(): string {
    // The morph class is based on the related model's type
    // This will be the type stored in the pivot table
    const instance = new (this.related.constructor as new () => Ensemble)();
    return MorphMap.getMorphedModel(instance);
  }

  /**
   * Set the join clause for the relation query
   * For inverse relations, we need to adjust the constraints
   */
  protected performJoin(query?: EnsembleBuilder<TRelated>): void {
    query = query || this.query;

    // Join the pivot table with morph type constraint
    // The difference from MorphToMany is that we're joining from the related side
    query
      .join(
        this.table,
        `${this.getQualifiedRelatedKeyName()}`,
        '=',
        `${this.getQualifiedForeignPivotKeyName()}` // Swapped for inverse
      )
      .where(`${this.table}.${this.morphType}`, '=', this.morphClass);
  }

  /**
   * Set the where clause for the relation query
   */
  protected addWhereConstraints(): void {
    const parentKeyValue = this.parent.getAttribute(this.parentKey);

    // Only add constraint if parent key value exists
    if (parentKeyValue !== null && parentKeyValue !== undefined) {
      this.query.where(
        this.getQualifiedRelatedPivotKeyName(), // Swapped for inverse
        '=',
        parentKeyValue
      );
    }
  }
}
