/**
 * RefreshDatabase
 *
 * Migrates the test database exactly once per process and then runs every
 * test inside a transaction that is rolled back afterwards - the Laravel
 * testing default. Because a fresh Application is built per test, the
 * migrated DatabaseManager is shared between them: an in-memory SQLite
 * database (whose data would otherwise vanish with each container) keeps
 * its schema for the whole run, while each test's writes are undone.
 *
 * Mirrors Illuminate\Foundation\Testing\RefreshDatabase.
 *
 * @example
 * ```typescript
 * class UserTest extends RefreshDatabase(TestCase) {
 *   migrationsPaths(): string[] {
 *     return [join(__dirname, 'fixtures/migrations')];
 *   }
 *
 *   async testUsersTableStartsEmpty() {
 *     await this.assertDatabaseEmpty('users');
 *   }
 * }
 * ```
 */

import type { DatabaseManagerConfig } from '@/Database/DatabaseManager';
import type { TestApplicationConstructor } from '@/Testing/contracts';
import { DrizzleAdapter } from '@/Database/Adapters/DrizzleAdapter';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { Migrator } from '@/Database/Migrations/Migrator';
import { DatabaseTransactions } from '@/Testing/DatabaseTransactions';

/**
 * Process-wide migration bookkeeping: the schema is built once, no matter
 * how many test classes use the mixin
 */
const refreshState: { migrated: boolean; manager: DatabaseManager | null } = {
  migrated: false,
  manager: null,
};

export function RefreshDatabase<T extends TestApplicationConstructor>(Base: T) {
  abstract class RefreshDatabaseMixin extends DatabaseTransactions(Base) {
    /**
     * Boot the app, make sure the shared migrated database is in place,
     * then open the rolled-back transaction
     */
    override async prepareDatabase(): Promise<void> {
      if (!refreshState.migrated) {
        refreshState.manager = await this.migrateFresh();

        refreshState.migrated = true;
      } else if (!refreshState.manager) {
        throw new Error(
          'RefreshDatabase state is inconsistent: migrations were flagged as run but no shared ' +
            'connection survived. Rebuild the process, or reset the database between suites.'
        );
      }

      // Route every resolution in this test's container through the
      // migrated manager so in-memory databases keep their schema
      this.app.instance('db', refreshState.manager);

      // The shared connection is the test database: flushing the
      // application must not drop it
      this.disconnectDatabaseOnFlush = false;

      // Models resolve their connection through the same shared manager
      Ensemble.setConnectionResolver(refreshState.manager);
    }

    /**
     * The directory (or directories) migrations are discovered in; the
     * conventional `database/migrations` under the application base path
     * Laravel: the migrate command's default path
     */
    migrationsPaths(): string[] {
      return [this.app.databasePath('migrations')];
    }

    /**
     * The connection migrations run on
     */
    migrationConnection(): string {
      return this.databaseManager().getDefaultConnection();
    }

    /**
     * Build the manager under test and run the pending migrations
     * Laravel: artisan migrate:fresh (once per process)
     */
    async migrateFresh(): Promise<DatabaseManager> {
      const manager = this.buildSharedDatabase();

      const connection = manager.connection(this.migrationConnection());

      await connection.connect();

      const migrator = new Migrator(connection, this.migrationsPaths());

      await migrator.run();

      return manager;
    }

    /**
     * A database manager for the test configuration - the container's
     * when one is registered, an in-memory SQLite default otherwise
     */
    buildSharedDatabase(): DatabaseManager {
      if (this.app.bound('db')) {
        return this.app.make<DatabaseManager>('db');
      }

      const config: DatabaseManagerConfig = {
        default: 'sqlite',
        connections: {
          sqlite: { adapter: 'drizzle', driver: 'better-sqlite3', database: ':memory:' },
        },
      };

      const manager = new DatabaseManager(config);

      manager.registerAdapter('drizzle', (connection) => new DrizzleAdapter(connection));

      return manager;
    }

    /**
     * Forget the process-wide migration state (test suites that need a
     * clean slate between databases)
     */
    static resetRefreshDatabaseState(): void {
      refreshState.migrated = false;
      refreshState.manager = null;
    }
  }

  return RefreshDatabaseMixin;
}
