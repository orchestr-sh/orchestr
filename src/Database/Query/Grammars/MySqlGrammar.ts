/**
 * MySQL Grammar
 *
 * Compiles query state for MySQL and MariaDB (the `mysql` / `mysql2` driver).
 */

import { QueryGrammar } from './QueryGrammar';

export class MySqlGrammar extends QueryGrammar {
  /**
   * MySQL quotes identifiers with backticks.
   */
  protected readonly wrapGlyph = '`';

  /**
   * MySQL has no `RETURNING` clause; the generated key comes from the driver
   * result instead.
   */
  supportsReturning(): boolean {
    return false;
  }

  /**
   * MySQL reports `insertId` on the result header of a plain insert.
   */
  usesLastInsertId(): boolean {
    return true;
  }

  /**
   * MySQL booleans are tinyint values.
   */
  protected parameterizeBoolean(value: boolean): string {
    return value ? '1' : '0';
  }

  /**
   * MySQL string literals honour backslash escapes as well as doubled quotes.
   */
  protected quoteLiteral(value: string): string {
    return `'${value.split('\\').join('\\\\').split("'").join("\\'")}'`;
  }

  /**
   * End of a quoted region, skipping over backslash escapes as MySQL does.
   */
  protected endOfQuoted(sql: string, start: number, quote: string): number {
    let index = start + 1;

    while (index < sql.length) {
      const char = sql[index];

      if (char === '\\') {
        index += 2;
        continue;
      }

      if (char === quote) {
        if (sql[index + 1] === quote) {
          index += 2;
          continue;
        }

        return index + 1;
      }

      index += 1;
    }

    return sql.length;
  }
}
