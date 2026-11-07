/**
 * Global Scope Contract
 *
 * A scope constrains every query built for a model. It is applied once per
 * query, against both the builder and the model being queried, which lets a
 * scope read model-level configuration (such as the soft-delete column) while
 * constraining the statement.
 *
 * Mirrors `Illuminate\Database\Eloquent\Scope`.
 */

import type { Ensemble } from './Ensemble';
import type { EnsembleBuilder } from './EnsembleBuilder';

export interface Scope {
  /**
   * Apply the scope to a given Ensemble query
   */
  apply(builder: EnsembleBuilder<any>, model: Ensemble): void;
}

/**
 * A closure registered as a global scope. Receives the same arguments as
 * `Scope.apply`, so ad-hoc scopes need no class.
 */
export type GlobalScopeCallback = (builder: EnsembleBuilder<any>, model: Ensemble) => void;

/**
 * Anything accepted as a global scope: a `Scope` instance or a closure.
 */
export type AnyGlobalScope = Scope | GlobalScopeCallback;
