/**
 * Schema Grammars Index
 *
 * Export every schema grammar and map configured drivers onto them.
 *
 * Like the query grammar registry, this is the only place that knows which
 * dialect speaks which grammar: supporting a new driver for migrations means
 * adding a schema grammar and a line here, never editing the schema builder.
 */

import { MySqlSchemaGrammar } from './MySqlSchemaGrammar';
import { PostgresSchemaGrammar } from './PostgresSchemaGrammar';
import { SchemaGrammar } from './SchemaGrammar';
import { SqliteSchemaGrammar } from './SqliteSchemaGrammar';

export { SchemaGrammar } from './SchemaGrammar';
export type { SchemaConnection } from './SchemaGrammar';
export { SqliteSchemaGrammar } from './SqliteSchemaGrammar';
export { PostgresSchemaGrammar } from './PostgresSchemaGrammar';
export { MySqlSchemaGrammar } from './MySqlSchemaGrammar';

/**
 * Grammar per driver name, including the aliases `DrizzleAdapter` accepts.
 */
const GRAMMARS: Record<string, new () => SchemaGrammar> = {
  sqlite: SqliteSchemaGrammar,
  'better-sqlite3': SqliteSchemaGrammar,
  postgres: PostgresSchemaGrammar,
  postgresjs: PostgresSchemaGrammar,
  postgresql: PostgresSchemaGrammar,
  pgsql: PostgresSchemaGrammar,
  mysql: MySqlSchemaGrammar,
  mysql2: MySqlSchemaGrammar,
  mariadb: MySqlSchemaGrammar,
};

/**
 * The driver names a schema grammar exists for.
 */
export function supportedSchemaGrammarDrivers(): string[] {
  return Object.keys(GRAMMARS);
}

/**
 * Build the schema grammar for a configured database driver.
 */
export function schemaGrammarForDriver(driver: string): SchemaGrammar {
  const Grammar = GRAMMARS[String(driver).toLowerCase()];

  if (!Grammar) {
    throw new Error(
      `No schema grammar is registered for the [${driver}] driver. ` +
        `Supported drivers: ${supportedSchemaGrammarDrivers().join(', ')}.`
    );
  }

  return new Grammar();
}
