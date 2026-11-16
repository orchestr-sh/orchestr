/**
 * DatabaseTransactions
 *
 * Wraps each test in a database transaction and rolls it back afterwards,
 * leaving the schema (and everything already committed) untouched. Unlike
 * RefreshDatabase it never migrates - pair it with a schema another test
 * (or a migration fixture) brought up.
 *
 * Mirrors Illuminate\Foundation\Testing\DatabaseTransactions.
 */

import type { DatabaseManager } from '@/Database/DatabaseManager';
import type { TestApplicationConstructor } from '@/Testing/contracts';

export function DatabaseTransactions<T extends TestApplicationConstructor>(Base: T) {
  abstract class DatabaseTransactionsMixin extends Base {
    /**
     * Connections with an open test transaction
     */
    openTransactions: string[] = [];

    /**
     * Boot the application, give subclasses a chance to prepare the
     * schema, then open the transaction-wrapped test database
     */
    override async setUp(): Promise<void> {
      await super.setUp();

      await this.prepareDatabase();

      await this.beginTransactions();
    }

    /**
     * Roll every opened transaction back before the application flushes
     */
    override async tearDown(): Promise<void> {
      await this.rollbackTransactions();

      await super.tearDown();
    }

    /**
     * The connections to wrap; the default connection unless overridden
     * Laravel: RefreshDatabase::$connectionsToTransact
     */
    transactionConnections(): string[] | undefined {
      return undefined;
    }

    /**
     * Hook for subclasses to bring the schema up (migrate) before the
     * test transaction opens
     */
    async prepareDatabase(): Promise<void> {
      // no-op: transactions alone are the whole job here
    }

    /**
     * Open a transaction on each connection the test transacts
     * Laravel: DatabaseTransactions::beginDatabaseTransaction
     */
    async beginTransactions(): Promise<void> {
      const database = this.databaseManager();

      const names = this.transactionConnections() ?? [database.getDefaultConnection()];

      for (const name of names) {
        const connection = database.connection(name);

        await connection.connect();
        await connection.beginTransaction();

        this.openTransactions.push(name);
      }
    }

    /**
     * Roll back everything the test wrote
     */
    async rollbackTransactions(): Promise<void> {
      if (this.openTransactions.length === 0) {
        return;
      }

      const database = this.databaseManager();

      for (const name of this.openTransactions.reverse()) {
        try {
          await database.connection(name).rollback();
        } catch {
          // A connection that cannot roll back is already gone
        }
      }

      this.openTransactions = [];
    }

    /**
     * The application's database manager
     */
    databaseManager(): DatabaseManager {
      if (!this.app.bound('db')) {
        throw new Error('DatabaseTransactions needs the DatabaseServiceProvider registered on the test application.');
      }

      return this.app.make<DatabaseManager>('db');
    }
  }

  return DatabaseTransactionsMixin;
}
