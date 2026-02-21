/**
 * MorphToMany Relationship
 *
 * Represents a polymorphic many-to-many relationship from the parent side
 * Example: Post has many Tags (where Tag can belong to many types via taggables table)
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleBuilder } from '@/Database/Ensemble/EnsembleBuilder';
import { BelongsToMany } from './BelongsToMany';
import { MorphMap } from './MorphMap';

export class MorphToMany<TRelated extends Ensemble, TParent extends Ensemble> extends BelongsToMany<TRelated, TParent> {
  /**
   * The morph type column (e.g., 'taggable_type')
   */
  protected morphType: string;

  /**
   * The morph class name or alias
   */
  protected morphClass: string;

  /**
   * Whether this is the inverse of the relation
   */
  protected inverse: boolean;

  /**
   * Create a new morph to many relationship instance
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
    relationName?: string,
    inverse: boolean = false
  ) {
    super(query, parent, table, foreignPivotKey, relatedPivotKey, parentKey, relatedKey, relationName);

    this.morphType = morphType;
    this.morphClass = this.getMorphClass();
    this.inverse = inverse;
  }

  /**
   * Set the join clause for the relation query
   * Adds the morph type constraint
   */
  protected performJoin(query?: EnsembleBuilder<TRelated>): void {
    query = query || this.query;

    // Join the pivot table with morph type constraint
    query
      .join(this.table, `${this.getQualifiedRelatedKeyName()}`, '=', `${this.getQualifiedRelatedPivotKeyName()}`)
      .where(`${this.table}.${this.morphType}`, '=', this.morphClass);
  }

  /**
   * Set the where clause for eager loading
   */
  protected addWhereConstraints(): void {
    const parentKeyValue = this.parent.getAttribute(this.parentKey);

    // Only add constraint if parent key value exists
    if (parentKeyValue !== null && parentKeyValue !== undefined) {
      this.query.where(this.getQualifiedForeignPivotKeyName(), '=', parentKeyValue);
    }
  }

  /**
   * Get the morph class for the parent during initialization
   */
  protected getMorphClass(): string {
    if (this.inverse) {
      // For inverse relations, we don't set the morph class on parent
      // It will be set per attach/sync operation
      return '';
    }

    return MorphMap.getMorphedModel(this.parent);
  }

  /**
   * Get the morph type name
   */
  getMorphType(): string {
    return this.morphType;
  }

  /**
   * Get the morph class value
   */
  getMorphClassValue(): string {
    return this.morphClass;
  }

  /**
   * Set the morph class (used for inverse relations)
   */
  setMorphClass(morphClass: string): this {
    this.morphClass = morphClass;
    return this;
  }

  /**
   * Attach models to the parent with morph type
   */
  async attach(ids: any | any[], attributes: Record<string, any> = {}, touch: boolean = true): Promise<void> {
    const idsArray = Array.isArray(ids) ? ids : [ids];
    const parentKey = this.parent.getAttribute(this.parentKey);

    if (!parentKey) {
      throw new Error('Parent key must be set before attaching');
    }

    const records = idsArray.map((id) => ({
      [this.foreignPivotKey]: parentKey,
      [this.relatedPivotKey]: id,
      [this.morphType]: this.morphClass,
      ...attributes,
    }));

    const connection = this.parent.getConnection();
    await connection.table(this.table).insert(records);
  }

  /**
   * Detach models from the parent with morph type constraint
   */
  async detach(ids?: any | any[]): Promise<number> {
    const query = this.newPivotQuery();
    const parentKey = this.parent.getAttribute(this.parentKey);

    if (!parentKey) {
      return 0;
    }

    query.where(this.foreignPivotKey, '=', parentKey).where(this.morphType, '=', this.morphClass);

    if (ids) {
      const idsArray = Array.isArray(ids) ? ids : [ids];
      query.whereIn(this.relatedPivotKey, idsArray);
    }

    return query.delete();
  }

  /**
   * Sync the intermediate tables with morph type
   */
  async sync(ids: any[], detaching: boolean = true): Promise<{ attached: any[]; detached: any[]; updated: any[] }> {
    const changes = {
      attached: [] as any[],
      detached: [] as any[],
      updated: [] as any[],
    };

    const parentKey = this.parent.getAttribute(this.parentKey);
    if (!parentKey) {
      return changes;
    }

    // Get current IDs
    const current = await this.newPivotQuery()
      .where(this.foreignPivotKey, '=', parentKey)
      .where(this.morphType, '=', this.morphClass)
      .select(this.relatedPivotKey)
      .get();

    const currentIds = current.map((record: any) => record[this.relatedPivotKey]);
    const idsToAttach = ids.filter((id) => !currentIds.includes(id));
    const idsToDetach = detaching ? currentIds.filter((id: any) => !ids.includes(id)) : [];

    // Detach old records
    if (idsToDetach.length > 0) {
      await this.detach(idsToDetach);
      changes.detached = idsToDetach;
    }

    // Attach new records
    if (idsToAttach.length > 0) {
      await this.attach(idsToAttach);
      changes.attached = idsToAttach;
    }

    return changes;
  }

  /**
   * Create a new pivot query
   */
  protected newPivotQuery(): EnsembleBuilder<any> {
    const connection = this.parent.getConnection();
    return connection.table(this.table) as any;
  }
}
