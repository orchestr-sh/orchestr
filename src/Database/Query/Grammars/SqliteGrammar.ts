/**
 * SQLite Grammar
 *
 * Compiles query state for SQLite (and the `better-sqlite3` driver).
 */

import { QueryGrammar, type QueryState } from './QueryGrammar';

export class SqliteGrammar extends QueryGrammar {
  /**
   * SQLite quotes identifiers with double quotes.
   */
  protected readonly wrapGlyph = '"';

  /**
   * SQLite has had `RETURNING` since 3.35 (2021).
   */
  supportsReturning(): boolean {
    return true;
  }

  /**
   * `better-sqlite3` reports `lastInsertRowid` for a plain insert, so the
   * generated key does not need a `RETURNING` clause.
   */
  usesLastInsertId(): boolean {
    return true;
  }

  /**
   * SQLite has no `TRUNCATE TABLE`; a `DELETE` without a where clause is its
   * equivalent.
   */
  compileTruncate(query: QueryState): string {
    return `DELETE FROM ${this.wrapTable(this.requireTable(query))}`;
  }

  /**
   * SQLite stores booleans as integers.
   */
  protected parameterizeBoolean(value: boolean): string {
    return value ? '1' : '0';
  }
}
