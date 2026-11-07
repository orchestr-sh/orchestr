/**
 * Soft Deletes Contract
 *
 * Models opt in with `protected static softDeletes = true`. From then on
 * `delete()` stamps the `deleted_at` column instead of removing the row, and
 * queries hide trashed rows through the `SoftDeletingScope`. The interface
 * documents the contract the `Ensemble` base class provides; import it to
 * type against soft-deleting models.
 */

export interface SoftDeletes {
  /**
   * Indicates if the model is currently force deleting
   */
  forceDeleting: boolean;

  /**
   * Determine whether this model soft deletes instead of removing rows
   */
  usesSoftDeletes(): boolean;

  /**
   * Delete the model, soft deleting it when the model is configured to
   */
  delete(): Promise<boolean>;

  /**
   * Force a hard delete on a soft deleted model
   */
  forceDelete(): Promise<boolean>;

  /**
   * Restore a soft-deleted model instance
   */
  restore(): Promise<boolean>;

  /**
   * Determine if the model instance has been soft-deleted
   */
  trashed(): boolean;

  /**
   * Get the name of the "deleted at" column
   */
  getDeletedAtColumn(): string;

  /**
   * Get the fully qualified "deleted at" column
   */
  getQualifiedDeletedAtColumn(): string;
}

/**
 * Default deleted at column name
 */
export const DELETED_AT = 'deleted_at';
