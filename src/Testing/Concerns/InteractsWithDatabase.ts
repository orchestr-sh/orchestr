/**
 * InteractsWithDatabase
 *
 * Database assertions for the test case: existence, counts, emptiness and
 * soft-delete state, expressed against tables or model instances. Querying
 * goes through the application's own DatabaseManager/Connection (DRY), so
 * assertions see exactly what the application writes - including rows the
 * RefreshDatabase/DatabaseTransactions mixins keep inside a rolled-back
 * transaction.
 *
 * Mirrors Illuminate\Foundation\Testing\Concerns\InteractsWithDatabase.
 */

import type { Connection } from '@/Database/Connection';
import type { DatabaseManager } from '@/Database/DatabaseManager';
import type { Builder } from '@/Database/Query/Builder';
import type { Application } from '@/Foundation/Application';
import type { TestApplicationConstructor } from '@/Testing/contracts';

/**
 * The duck-typed model surface the assertions need: table, key, and
 * optionally the soft-delete column (Ensemble models satisfy all three)
 */
export interface ModelLike {
  getTable(): string;
  getKeyName(): string;
  getKey(): any;
  getDeletedAtColumn?(): string;
}

/**
 * What the assertions accept as the "where" input
 */
export type DatabaseCriteria = Record<string, any>;

/**
 * Default Laravel soft-delete column, used when a bare table is asserted
 * without a model to read the column name from
 */
const DEFAULT_DELETED_AT = 'deleted_at';

export function InteractsWithDatabase<T extends TestApplicationConstructor>(Base: T) {
  abstract class InteractsWithDatabaseMixin extends Base {
    /**
     * Assert the given table has a matching row
     * Laravel: assertDatabaseHas
     */
    async assertDatabaseHas(
      table: string | ModelLike,
      where: DatabaseCriteria = {},
      connection?: string
    ): Promise<this> {
      const [tableName, criteria] = this.criteriaFor(table, where);

      if (!(await this.buildQuery(tableName, criteria, connection).exists())) {
        throw new Error(
          `The [${tableName}] table should have contained a row matching ${JSON.stringify(criteria)} but did not.`
        );
      }

      return this;
    }

    /**
     * Assert the given table has no matching row
     * Laravel: assertDatabaseMissing
     */
    async assertDatabaseMissing(
      table: string | ModelLike,
      where: DatabaseCriteria = {},
      connection?: string
    ): Promise<this> {
      const [tableName, criteria] = this.criteriaFor(table, where);

      if (await this.buildQuery(tableName, criteria, connection).exists()) {
        throw new Error(
          `The [${tableName}] table was not expected to contain a row matching ${JSON.stringify(criteria)} but it did.`
        );
      }

      return this;
    }

    /**
     * Assert the given table contains exactly this many matching rows
     * Laravel: assertDatabaseCount
     */
    async assertDatabaseCount(table: string, count: number, connection?: string): Promise<this> {
      const actual = Number(await this.buildQuery(table, {}, connection).count());

      if (actual !== count) {
        throw new Error(`The [${table}] table contained ${actual} rows, but ${count} were expected.`);
      }

      return this;
    }

    /**
     * Assert the given table contains no rows at all
     * Laravel: assertDatabaseEmpty
     */
    async assertDatabaseEmpty(table: string, connection?: string): Promise<this> {
      return this.assertDatabaseCount(table, 0, connection);
    }

    /**
     * Assert the model has a row in the database
     * Laravel: assertModelExists
     */
    async assertModelExists(model: ModelLike, connection?: string): Promise<this> {
      return this.assertDatabaseHas(model.getTable(), this.modelKey(model), connection);
    }

    /**
     * Assert the model has no row in the database
     * Laravel: assertModelMissing
     */
    async assertModelMissing(model: ModelLike, connection?: string): Promise<this> {
      return this.assertDatabaseMissing(model.getTable(), this.modelKey(model), connection);
    }

    /**
     * Assert the row exists with its deleted-at column stamped
     * Laravel: assertSoftDeleted
     */
    async assertSoftDeleted(
      tableOrModel: string | ModelLike,
      where: DatabaseCriteria = {},
      connection?: string
    ): Promise<this> {
      const [tableName, criteria] = this.criteriaFor(tableOrModel, where);
      const deletedAt = deletedAtColumn(tableOrModel);

      const found = await this.applyCriteria(
        this.database().connection(connection).table(tableName).whereNotNull(deletedAt),
        criteria
      ).exists();

      if (!found) {
        throw new Error(
          `A [${tableName}] record matching ${JSON.stringify(criteria)} was not found soft-deleted ` +
            `([${deletedAt}] set) in the database.`
        );
      }

      return this;
    }

    /**
     * Assert the row exists with its deleted-at column unset
     * Laravel: assertNotSoftDeleted
     */
    async assertNotSoftDeleted(
      tableOrModel: string | ModelLike,
      where: DatabaseCriteria = {},
      connection?: string
    ): Promise<this> {
      const [tableName, criteria] = this.criteriaFor(tableOrModel, where);
      const deletedAt = deletedAtColumn(tableOrModel);

      const found = await this.applyCriteria(
        this.database().connection(connection).table(tableName).whereNull(deletedAt),
        criteria
      ).exists();

      if (!found) {
        throw new Error(
          `A [${tableName}] record matching ${JSON.stringify(criteria)} was not found undeleted ` +
            `([${deletedAt}] unset) in the database.`
        );
      }

      return this;
    }

    // ==================== Internals ====================

    /**
     * The application's database manager
     */
    database(): DatabaseManager {
      const app = (this as { app?: Application }).app;

      if (!app || !app.bound('db')) {
        throw new Error('Register the DatabaseServiceProvider before making database assertions.');
      }

      return app.make<DatabaseManager>('db');
    }

    /**
     * A fresh query against a table with the given equality criteria
     */
    buildQuery(table: string, criteria: DatabaseCriteria, connection?: string): Builder {
      return this.applyCriteria(this.database().connection(connection).table(table), criteria);
    }

    /**
     * Layer criteria onto a builder; null values compare IS NULL like
     * Laravel's where arrays do
     */
    applyCriteria(query: Builder, criteria: DatabaseCriteria): Builder {
      for (const [column, value] of Object.entries(criteria)) {
        if (value === null) {
          query.whereNull(column);
        } else if (Array.isArray(value)) {
          query.whereIn(column, value);
        } else {
          query.where(column, value);
        }
      }

      return query;
    }

    /**
     * Normalize (table-or-model, where) into [table, criteria]
     */
    criteriaFor(table: string | ModelLike, where: DatabaseCriteria): [string, DatabaseCriteria] {
      if (typeof table === 'string') {
        return [table, where];
      }

      return [table.getTable(), { ...this.modelKey(table), ...where }];
    }

    /**
     * The primary-key criteria addressing a model's row
     */
    modelKey(model: ModelLike): DatabaseCriteria {
      return { [model.getKeyName()]: model.getKey() };
    }
  }

  return InteractsWithDatabaseMixin;
}

/**
 * The soft-delete column for a model, or Laravel's deleted_at default
 */
function deletedAtColumn(tableOrModel: string | ModelLike): string {
  if (typeof tableOrModel !== 'string' && typeof tableOrModel.getDeletedAtColumn === 'function') {
    return tableOrModel.getDeletedAtColumn();
  }

  return DEFAULT_DELETED_AT;
}
