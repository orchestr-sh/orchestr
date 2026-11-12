/**
 * Relationship Aggregates
 *
 * The catalogue of aggregate functions Ensemble can eager load, plus the
 * normalisation every `with*` / `load*` aggregate entry point funnels through.
 *
 * Keeping the functions in one registry is what lets the builder have a single
 * `withAggregate` core: a new aggregate - another way of reading `MAX`, say - is
 * a descriptor added here plus a one-line wrapper, never another copy of the
 * sub-select, grouping and matching logic. A descriptor's `func` has to be one
 * the query grammar compiles (`count`, `min`, `max`, `avg`, `sum`), so a
 * genuinely new SQL function is a grammar addition as well.
 */

import { Str } from '@/Support/Str';

/**
 * Constraints a caller adds to the related query an aggregate runs over
 */
export type AggregateConstraints = (query: any) => void;

/**
 * One aggregate eager load: the relation it walks, the SQL it asks the related
 * table for, and the attribute the result lands in.
 */
export interface AggregateLoad {
  /**
   * Registry key of the function to apply (`count`, `sum`, ...)
   */
  type: string;

  /**
   * Name of the relation to aggregate over
   */
  relation: string;

  /**
   * Column the function wraps; `*` for `count` and `exists`
   */
  column: string;

  /**
   * Attribute attached to each parent model
   */
  as: string;

  /**
   * Extra constraints for the related query
   */
  constraints?: AggregateConstraints;
}

/**
 * An aggregate the builder knows how to run.
 */
export interface AggregateFunction {
  /**
   * SQL function the grammar wraps the column in. Existence checks run on a
   * grouped `COUNT(*)` and are cast afterwards, which keeps one query shape for
   * every aggregate.
   */
  func: string;

  /**
   * Value attached when the relation has no rows, matching what the equivalent
   * sub-select would hand back: `0` for counts, `false` for existence and
   * `null` for the rest.
   */
  empty: any;

  /**
   * Turn the grouped SQL value into the attribute value (booleans, numbers the
   * driver may hand back as strings).
   */
  cast?: (value: any) => any;
}

/**
 * Aggregate columns the driver may hand back as strings (PostgreSQL's numeric
 * types do exactly that); counts and existence flags always resolve to a number.
 */
function toNumberOrNull(value: any): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Aggregate functions keyed by the type name callers pass to `withAggregate`.
 */
const FUNCTIONS: Record<string, AggregateFunction> = {
  count: { func: 'count', empty: 0, cast: (value: any) => Number(value) },
  sum: { func: 'sum', empty: null, cast: toNumberOrNull },
  avg: { func: 'avg', empty: null, cast: toNumberOrNull },
  min: { func: 'min', empty: null },
  max: { func: 'max', empty: null },
  exists: { func: 'count', empty: false, cast: (value: any) => Number(value) > 0 },
};

/**
 * Look up an aggregate function by type name.
 */
export function aggregateFunction(type: string): AggregateFunction {
  const fn = FUNCTIONS[type];

  if (!fn) {
    throw new Error(
      `Unknown aggregate function [${type}]. Registered aggregates: ${Object.keys(FUNCTIONS).join(', ')}.`
    );
  }

  return fn;
}

/**
 * The relation names an aggregate accepts: one name, a list of names, or a map
 * of name to alias (`{ comments: 'pending_count' })` or to the constraints the
 * related query runs with.
 */
export type AggregateRelations = string | string[] | Record<string, string | AggregateConstraints>;

/**
 * Attribute name an aggregate gets when the caller does not name it.
 *
 * Mirrors Eloquent's `{relation}_{function}[_{column}]` shape, so `withCount`
 * gives `posts_count`, `withSum('comments', 'votes')` gives
 * `comments_sum_votes`, and an explicit `as` alias replaces the whole thing.
 */
export function aggregateAlias(relation: string, type: string, column: string): string {
  const parts = [Str.snake(relation), Str.snake(type)];

  if (column !== '*') {
    parts.push(Str.snake(column));
  }

  return parts.join('_');
}

/**
 * Parse one relation entry into the relation name and the alias it asked for.
 *
 * Eloquent spells an alias inside the name (`'comments as pending_count'`), so
 * both spellings are understood: the name form and a string value in the map.
 */
function splitAlias(name: string, alias?: string): { relation: string; as?: string } {
  const segments = name.split(/\s+as\s+/i);

  if (segments.length > 1) {
    return { relation: segments[0].trim(), as: segments.slice(1).join(' ').trim() || undefined };
  }

  return { relation: name.trim(), as: alias };
}

/**
 * Build the aggregate loads a `with*`/`load*` call registers.
 *
 * @param type - Aggregate function name from the registry
 * @param relations - Relation names, optionally aliased or constrained
 * @param column - Column the function wraps; `*` when the aggregate needs none
 */
export function createAggregateLoads(
  type: string,
  relations: AggregateRelations,
  column: string = '*'
): AggregateLoad[] {
  // Validated up front so an unknown aggregate fails before any query runs.
  aggregateFunction(type);

  const entries: Array<[string, string | AggregateConstraints | undefined]> =
    typeof relations === 'string'
      ? [[relations, undefined]]
      : Array.isArray(relations)
        ? relations.map((relation) => [relation, undefined] as [string, undefined])
        : Object.entries(relations);

  const loads: AggregateLoad[] = [];

  for (const [name, value] of entries) {
    const { relation, as } = splitAlias(name, typeof value === 'string' ? value : undefined);
    const constraints = typeof value === 'function' ? value : undefined;

    if (relation === '') {
      throw new Error(`Aggregate [${type}] was given an empty relation name.`);
    }

    if (relation.includes('.')) {
      throw new Error(
        `Nested aggregate relations are not supported ([${relation}] for [${type}]). ` +
          'Aggregate a direct relation, or eager load the path and aggregate the loaded models.'
      );
    }

    loads.push({ type, relation, column, as: as ?? aggregateAlias(relation, type, column), constraints });
  }

  return loads;
}
