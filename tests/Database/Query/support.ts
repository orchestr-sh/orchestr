/**
 * Shared helpers for the query grammar and query builder tests.
 *
 * The adapter recorder captures every statement a builder hands to the driver,
 * which is what makes identifier quoting and binding order assertable.
 */

import { vi } from 'vitest';
import type { DatabaseAdapter } from '@/Database/Contracts/DatabaseAdapter';
import type { QueryGrammar, QueryState } from '@/Database/Query/Grammars';
import { Builder } from '@/Database/Query/Builder';

/**
 * One statement the builder asked the adapter to run.
 */
export interface ExecutedQuery {
  method: 'select' | 'insert' | 'update' | 'delete' | 'query';
  sql: string;
  bindings: any[];
}

/**
 * A complete query state with only the parts a test cares about overridden.
 */
export function queryState(overrides: Partial<QueryState> = {}): QueryState {
  return {
    table: 'users',
    columns: ['*'],
    distinct: false,
    joins: [],
    wheres: [],
    groups: [],
    havings: [],
    orders: [],
    ...overrides,
  };
}

/**
 * Build an adapter stub that records every statement it is asked to execute.
 * Resolved values come from `results`, keyed by method name, so a test can hand
 * rows back for a select or a generated key for an insert.
 */
export function recordAdapter(results: Partial<Record<ExecutedQuery['method'], any>> = {}): {
  adapter: DatabaseAdapter;
  queries: ExecutedQuery[];
} {
  const queries: ExecutedQuery[] = [];

  const record = (method: ExecutedQuery['method']) =>
    vi.fn(async (sql: string, bindings: any[] = []) => {
      queries.push({ method, sql, bindings });

      if (method === 'select' && results.select === undefined) {
        return [];
      }

      return results[method];
    });

  const adapter = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    transaction: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    getDriver: vi.fn(),
    getTableInfo: vi.fn(),
    getTables: vi.fn(),
    query: record('query'),
    select: record('select'),
    insert: record('insert'),
    update: record('update'),
    delete: record('delete'),
  } as unknown as DatabaseAdapter;

  return { adapter, queries };
}

/**
 * A builder on a recording adapter, already pointed at `table`.
 */
export function queryOn(
  grammar: QueryGrammar,
  table: string = 'users',
  results: Partial<Record<ExecutedQuery['method'], any>> = {}
): { builder: Builder; queries: ExecutedQuery[] } {
  const { adapter, queries } = recordAdapter(results);

  return { builder: new Builder(adapter, grammar).from(table), queries };
}
