/**
 * RefreshDatabase + InteractsWithDatabase against real SQLite
 *
 * The suite pins the mixin's promises: migrations run once and survive
 * the per-test transaction (so the second test still has a schema), each
 * test's writes roll back, and the assertion surface sees exactly what
 * the application wrote - models and soft deletes included.
 *
 * better-sqlite3 is an optional dependency, so - like the other database
 * suites - everything here skips when the driver is unusable.
 */

import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { DatabaseTransactions, RefreshDatabase, TestCase } from '@/Testing';
import { WITH_BETTER_SQLITE } from '../Database/support';

const migrationsPath = fileURLToPath(new URL('./fixtures/migrations', import.meta.url));

class User extends Ensemble {
  static softDeletes = true;
  static fillable = ['name', 'email'];

  getTable(): string {
    return 'users';
  }
}

class Post extends Ensemble {
  static fillable = ['title'];

  getTable(): string {
    return 'posts';
  }
}

describe.skipIf(!WITH_BETTER_SQLITE)('RefreshDatabase (better-sqlite3)', () => {
  class MigrationTestCase extends RefreshDatabase(TestCase) {
    migrationsPaths(): string[] {
      return [migrationsPath];
    }

    async testMigrationsBuiltTheSchema() {
      await this.assertDatabaseEmpty('users');
      await this.assertDatabaseEmpty('posts');
      await this.assertDatabaseCount('migrations', 2);
    }

    async testWritesAreVisibleWithinTheTest() {
      const ada = await User.create({ name: 'Ada' });

      await this.assertDatabaseHas('users', { name: 'Ada' });
      await this.assertModelExists(ada);
      await this.assertDatabaseCount('users', 1);
    }

    async testPreviousTestWritesRolledBack() {
      // The previous test created Ada; the per-test transaction undid it,
      // while the migrated schema (committed before any test) remains.
      await this.assertDatabaseEmpty('users');
      await this.assertDatabaseMissing('users', { name: 'Ada' });
      await this.assertDatabaseHas('migrations', { migration: '2026_01_01_000000_create_users_table' });
    }

    async testApplicationWritesRollBackToo() {
      await User.create({ name: 'Grace' });

      const users = await User.all();

      expect(users).toHaveLength(1);
    }

    async testStillEmptyAfterApplicationWrite() {
      await this.assertDatabaseEmpty('users');
    }
  }

  new MigrationTestCase();
});

describe.skipIf(!WITH_BETTER_SQLITE)('Database assertions (better-sqlite3)', () => {
  class AssertionTestCase extends RefreshDatabase(TestCase) {
    migrationsPaths(): string[] {
      return [migrationsPath];
    }

    async testEqualityAndNullCriteria() {
      await User.create({ name: 'Ada', email: 'ada@example.com' });
      await User.create({ name: 'Grace' });

      await this.assertDatabaseHas('users', { name: 'Ada', email: 'ada@example.com' });
      await this.assertDatabaseHas('users', { name: 'Grace', email: null });
      await this.assertDatabaseMissing('users', { name: 'Ada', email: null });
      await this.assertDatabaseMissing('users', { name: 'Nobody' });
      await this.assertDatabaseCount('users', 2);
    }

    async testModelAssertions() {
      const post = await Post.create({ title: 'Hello' });

      await this.assertModelExists(post);
      await this.assertDatabaseHas(post);

      await post.delete();

      await this.assertModelMissing(post);
    }

    async testSoftDeleteAssertions() {
      const user = await User.create({ name: 'Ada' });

      await this.assertNotSoftDeleted(user);
      await this.assertNotSoftDeleted('users', { name: 'Ada' });

      await user.delete();

      await this.assertSoftDeleted(user);
      await this.assertSoftDeleted('users', { name: 'Ada' });

      // The undeleted assertion now fails: the row exists but is trashed
      await expect(this.assertNotSoftDeleted(user)).rejects.toThrow(/was not found undeleted/);

      // The row is still there - a soft delete is not a removal
      await this.assertDatabaseCount('users', 1);
    }

    async testFailuresSayWhatWasMissing() {
      await expect(this.assertDatabaseHas('users', { name: 'Ghost' })).rejects.toThrow(
        /should have contained a row matching/
      );

      await expect(this.assertDatabaseEmpty('posts')).resolves.toBeTruthy();

      await Post.create({ title: 'Oops' });

      await expect(this.assertDatabaseEmpty('posts')).rejects.toThrow(/contained 1 rows, but 0 were expected/);
    }
  }

  new AssertionTestCase();
});

describe.skipIf(!WITH_BETTER_SQLITE)('DatabaseTransactions (better-sqlite3)', () => {
  class TransactionTestCase extends DatabaseTransactions(TestCase) {
    /**
     * The schema is built inside the test transaction (this mixin never
     * migrates), so it rolls back with the rows - CREATE TABLE IF NOT
     * EXISTS therefore belongs at the top of every test here.
     */
    protected async createNotes(): Promise<any> {
      const db = this.app.make<any>('db');

      await db.connection().query('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT)');

      return db;
    }

    async testRollsBackRawInserts() {
      const db = await this.createNotes();

      await db.connection().query('INSERT INTO notes (body) VALUES (?)', ['first']);

      const rows = await db.connection().table('notes').get();

      expect(rows).toHaveLength(1);
    }

    async testNotesTableIsEmptyAgain() {
      const db = await this.createNotes();

      // The previous test's insert (and its CREATE TABLE) rolled back with
      // the transaction; only this test's fresh table is visible, empty.
      const rows = await db.connection().table('notes').get();

      expect(rows).toHaveLength(0);
    }
  }

  new TransactionTestCase();
});
