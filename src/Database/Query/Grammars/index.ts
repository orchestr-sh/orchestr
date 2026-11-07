/**
 * Grammars Index
 *
 * Export every query grammar and map configured drivers onto them.
 *
 * This registry is the single place that knows which dialect speaks which
 * grammar: supporting a new driver means adding a grammar and a line here,
 * never editing the query builder.
 */

import { MySqlGrammar } from './MySqlGrammar';
import { PostgresGrammar } from './PostgresGrammar';
import { QueryGrammar } from './QueryGrammar';
import { SqliteGrammar } from './SqliteGrammar';

export { QueryGrammar, isListOperator } from './QueryGrammar';
export type { QueryState } from './QueryGrammar';
export { SqliteGrammar } from './SqliteGrammar';
export { PostgresGrammar } from './PostgresGrammar';
export { MySqlGrammar, quoteMySqlLiteral } from './MySqlGrammar';

/**
 * Grammar per driver name, including the aliases `DrizzleAdapter` accepts.
 */
const GRAMMARS: Record<string, new () => QueryGrammar> = {
  sqlite: SqliteGrammar,
  'better-sqlite3': SqliteGrammar,
  postgres: PostgresGrammar,
  postgresjs: PostgresGrammar,
  postgresql: PostgresGrammar,
  pgsql: PostgresGrammar,
  mysql: MySqlGrammar,
  mysql2: MySqlGrammar,
  mariadb: MySqlGrammar,
};

/**
 * The driver names a grammar exists for.
 */
export function supportedGrammarDrivers(): string[] {
  return Object.keys(GRAMMARS);
}

/**
 * Build the grammar for a configured database driver.
 */
export function grammarForDriver(driver: string): QueryGrammar {
  const Grammar = GRAMMARS[String(driver).toLowerCase()];

  if (!Grammar) {
    throw new Error(
      `No query grammar is registered for the [${driver}] driver. ` +
        `Supported drivers: ${supportedGrammarDrivers().join(', ')}.`
    );
  }

  return new Grammar();
}
