/**
 * SchemaBuilder
 *
 * Builds and executes schema migrations with support for multiple database drivers.
 *
 * The builder owns the fluent API and executes statements; every dialect
 * decision lives in the schema grammar it resolves from the connection's
 * driver, so nothing here switches on which database it is talking to.
 */

import type { Connection } from '@/Database/Connection';
import { Schema } from '@/Database/Contracts/Schema';
import { Blueprint } from './Blueprint';
import { schemaGrammarForDriver, type SchemaGrammar } from './Grammars';

export class SchemaBuilder implements Schema {
  protected grammar: SchemaGrammar;

  constructor(protected connection: Connection) {
    this.grammar = schemaGrammarForDriver(connection.getConfig().driver);
  }

  /**
   * The grammar this builder compiles statements with.
   */
  getGrammar(): SchemaGrammar {
    return this.grammar;
  }

  /**
   * Create a new table
   */
  async create(tableName: string, callback: (table: Blueprint) => void): Promise<void> {
    const blueprint = new Blueprint(tableName);
    blueprint.isCreate = true;
    callback(blueprint);

    await this.execute(this.grammar.compileCreate(blueprint));
  }

  /**
   * Modify an existing table
   */
  async table(tableName: string, callback: (table: Blueprint) => void): Promise<void> {
    const blueprint = new Blueprint(tableName);
    blueprint.isCreate = false;
    callback(blueprint);

    await this.execute(this.grammar.compileAlter(blueprint));
  }

  /**
   * Drop a table
   */
  async drop(tableName: string): Promise<void> {
    await this.connection.query(this.grammar.compileDropTable(tableName));
  }

  /**
   * Drop a table if it exists
   */
  async dropIfExists(tableName: string): Promise<void> {
    await this.connection.query(this.grammar.compileDropTableIfExists(tableName));
  }

  /**
   * Rename a table
   */
  async rename(from: string, to: string): Promise<void> {
    await this.connection.query(this.grammar.compileRenameTable(from, to));
  }

  /**
   * Determine if a table exists
   */
  async hasTable(tableName: string): Promise<boolean> {
    return this.grammar.hasTable(this.connection, tableName);
  }

  /**
   * Determine if a column exists on a table
   */
  async hasColumn(tableName: string, columnName: string): Promise<boolean> {
    return this.grammar.hasColumn(this.connection, tableName, columnName);
  }

  /**
   * Turn foreign key enforcement off for the connection.
   *
   * Dialects without a switch compile nothing, so this is safe to call
   * everywhere.
   */
  async disableForeignKeyConstraints(): Promise<void> {
    const sql = this.grammar.compileDisableForeignKeyConstraints();

    if (sql) {
      await this.connection.query(sql);
    }
  }

  /**
   * Turn foreign key enforcement back on for the connection.
   */
  async enableForeignKeyConstraints(): Promise<void> {
    const sql = this.grammar.compileEnableForeignKeyConstraints();

    if (sql) {
      await this.connection.query(sql);
    }
  }

  /**
   * Run a callback with foreign key enforcement switched off, restoring it
   * afterwards even when the callback throws.
   */
  async withoutForeignKeyConstraints<T>(callback: () => Promise<T> | T): Promise<T> {
    const run = async (): Promise<T> => {
      await this.disableForeignKeyConstraints();

      try {
        return await callback();
      } finally {
        await this.enableForeignKeyConstraints();
      }
    };

    // A dialect whose toggle is session scoped runs the whole span on one pinned
    // connection; the others need nothing beyond the statements themselves.
    return this.grammar.requiresPinnedSessionForConstraintToggle() ? this.connection.transaction(run) : run();
  }

  /**
   * Run compiled statements in the order the grammar produced them.
   */
  protected async execute(statements: string[]): Promise<void> {
    for (const statement of statements) {
      await this.connection.query(statement);
    }
  }
}
