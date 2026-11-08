/**
 * PostgreSQL Grammar
 *
 * Compiles query state for PostgreSQL (the `postgres` / `postgres.js` driver).
 */

import { QueryGrammar, type QueryState } from './QueryGrammar';

export class PostgresGrammar extends QueryGrammar {
  /**
   * PostgreSQL quotes identifiers with double quotes.
   */
  protected readonly wrapGlyph = '"';

  /**
   * PostgreSQL supports `RETURNING` on all data-modifying statements.
   */
  supportsReturning(): boolean {
    return true;
  }

  /**
   * PostgreSQL gives no generated key back for a plain insert, so
   * `insertGetId()` asks for the key column with `RETURNING`.
   */
  usesLastInsertId(): boolean {
    return false;
  }

  /**
   * Compile the insert with the generated key column appended, so the caller can
   * read it straight out of the returned row instead of assuming a column name.
   */
  compileInsertGetId(query: QueryState, record: Record<string, any>, sequence?: string): string {
    const column = this.generatedKeyColumn(query, sequence);

    return `${this.compileInsert(query, [record])} RETURNING ${this.wrap(column)}`;
  }
}
