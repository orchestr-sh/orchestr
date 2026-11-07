/**
 * Soft Deleting Scope
 *
 * The single place trashed rows are kept out of queries. It is registered as
 * a global scope on every model that opts into `static softDeletes`, so the
 * default exclusion runs through the scope pipeline once and is shared by
 * plain selects, aggregates, eager loads and relation queries — the builder's
 * `withTrashed()` / `onlyTrashed()` flags simply tell this scope which
 * constraint (if any) to add.
 *
 * Mirrors `Illuminate\Database\Eloquent\SoftDeletingScope`.
 */

import type { Ensemble } from './Ensemble';
import type { EnsembleBuilder } from './EnsembleBuilder';
import type { Scope } from './Scope';
import { GlobalScopeRegistry } from './GlobalScopeRegistry';

export class SoftDeletingScope implements Scope {
  /**
   * Identifier the scope is registered and removed under
   */
  static readonly identifier = 'SoftDeletingScope';

  /**
   * Apply the scope to a given Ensemble query
   */
  apply(builder: EnsembleBuilder<any>, model: Ensemble): void {
    if (builder.isOnlyTrashed()) {
      builder.whereNotNull(model.getQualifiedDeletedAtColumn());
      return;
    }

    if (!builder.isWithTrashed()) {
      builder.whereNull(model.getQualifiedDeletedAtColumn());
    }
  }

  /**
   * Register the scope for a soft-deleting model class. Called whenever an
   * Ensemble query builder is constructed — including the builders behind
   * relationships — so a model's scope is always in place before its first
   * query runs. Registering is idempotent: the scope is keyed by a fixed
   * identifier and re-adding replaces the same entry.
   */
  static registerFor(model: Ensemble): void {
    if (!model.usesSoftDeletes()) {
      return;
    }

    GlobalScopeRegistry.add(model.constructor, SoftDeletingScope.identifier, new SoftDeletingScope());
  }
}
