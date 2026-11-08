/**
 * Ensemble soft deletes against a real SQLite database
 *
 * The unit suite pins the compiled SQL; this one proves the behaviour the
 * ticket promises: a soft delete leaves the row behind, the default queries
 * hide it, `withTrashed`/`onlyTrashed` surface it, `restore()` brings it
 * back, and `forceDelete()` really removes it — with relations respecting
 * the scope along the way.
 *
 * better-sqlite3 is an optional dependency (and needs a native build), so
 * the integration suite only runs when the driver is actually installed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DrizzleAdapter } from '@/Database/Adapters/DrizzleAdapter';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';

async function hasBetterSqlite(): Promise<boolean> {
  try {
    await import('better-sqlite3');
    return true;
  } catch {
    return false;
  }
}

const SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
  );
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
  );
  CREATE TABLE pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT
  );
`;

const WITH_BETTER_SQLITE = await hasBetterSqlite();

// ---------------------------------------------------------------------------
// Test models
// ---------------------------------------------------------------------------

class User extends Ensemble {
  static softDeletes = true;
  static fillable: string[] = ['name'];

  getTable(): string {
    return 'users';
  }

  posts() {
    return this.hasMany(Post, 'user_id');
  }
}

class Post extends Ensemble {
  static softDeletes = true;
  static fillable: string[] = ['title', 'user_id'];

  getTable(): string {
    return 'posts';
  }

  user() {
    return this.belongsTo(User, 'user_id');
  }
}

class Page extends Ensemble {
  static fillable: string[] = ['title'];
  protected timestamps: boolean = false;

  getTable(): string {
    return 'pages';
  }
}

describe.skipIf(!WITH_BETTER_SQLITE)('Ensemble soft deletes (better-sqlite3)', () => {
  let adapter: DrizzleAdapter;

  beforeEach(async () => {
    adapter = new DrizzleAdapter({ driver: 'better-sqlite3', database: ':memory:' });
    await adapter.connect();

    for (const statement of SCHEMA.split(';').filter((s) => s.trim() !== '')) {
      await adapter.query(statement);
    }

    const manager = new DatabaseManager({
      default: 'main',
      connections: {
        main: { adapter: 'drizzle', driver: 'better-sqlite3', database: ':memory:' },
      },
    });
    manager.registerAdapter('drizzle', () => adapter);
    Ensemble.setConnectionResolver(manager);
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  async function rowCount(table: string): Promise<number> {
    const rows = await adapter.select<{ count: number }>(`SELECT COUNT(*) as count FROM ${table}`);
    return rows[0].count;
  }

  it('leaves the row in the table when deleting', async () => {
    const user = await User.create({ name: 'Ada' });

    expect(await user.delete()).toBe(true);

    // The row is still there, tagged with a deleted_at timestamp
    expect(await rowCount('users')).toBe(1);
    const raw = await adapter.select<{ deleted_at: string; updated_at: string }>(
      'SELECT deleted_at, updated_at FROM users WHERE id = ?',
      [user.getKey()]
    );
    expect(raw[0].deleted_at).not.toBeNull();
    expect(raw[0].updated_at).not.toBeNull();
    expect(Number.isNaN(new Date(raw[0].deleted_at).getTime())).toBe(false);

    // And the instance knows it is trashed
    expect(user.trashed()).toBe(true);
    expect(user.getAttribute('deleted_at')).toBeInstanceOf(Date);
    expect(user.exists).toBe(true);
  });

  it('hides trashed rows by default and surfaces them on demand', async () => {
    const ada = await User.create({ name: 'Ada' });
    await User.create({ name: 'Grace' });
    await ada.delete();

    const visible = await User.query().get();
    expect(visible.map((u) => u.getAttribute('name'))).toEqual(['Grace']);

    const everything = await User.query().withTrashed().get();
    expect(everything).toHaveLength(2);

    const trashedOnly = await User.query().onlyTrashed().get();
    expect(trashedOnly.map((u) => u.getAttribute('name'))).toEqual(['Ada']);
    expect(trashedOnly[0].trashed()).toBe(true);

    expect(await User.query().count()).toBe(1);
    expect(await User.query().withTrashed().count()).toBe(2);
    expect(await User.query().onlyTrashed().count()).toBe(1);
  });

  it('find() skips trashed rows, withTrashed() reaches them', async () => {
    const user = await User.create({ name: 'Ada' });
    await user.delete();

    expect(await User.find(user.getKey())).toBeNull();
    expect(await User.query().withTrashed().find(user.getKey())).not.toBeNull();
  });

  it('restore() clears deleted_at and makes the row visible again', async () => {
    const user = await User.create({ name: 'Ada' });
    await user.delete();

    expect(await User.query().get()).toHaveLength(0);

    expect(await user.restore()).toBe(true);
    expect(user.trashed()).toBe(false);

    expect(await User.query().get()).toHaveLength(1);
    const raw = await adapter.select<{ deleted_at: unknown }>('SELECT deleted_at FROM users WHERE id = ?', [
      user.getKey(),
    ]);
    expect(raw[0].deleted_at).toBeNull();
  });

  it('forceDelete() removes the row entirely', async () => {
    const user = await User.create({ name: 'Ada' });

    expect(await user.forceDelete()).toBe(true);
    expect(await rowCount('users')).toBe(0);
  });

  it('forceDelete() purges rows that were soft deleted', async () => {
    const ada = await User.create({ name: 'Ada' });
    await User.create({ name: 'Grace' });
    await ada.delete();

    expect(await User.query().onlyTrashed().forceDelete()).toBe(1);

    expect(await rowCount('users')).toBe(1);
    expect((await User.query().withTrashed().get()).map((u) => u.getAttribute('name'))).toEqual(['Grace']);
  });

  it('restore() on the builder clears the stamp on trashed rows only', async () => {
    const ada = await User.create({ name: 'Ada' });
    await User.create({ name: 'Grace' });
    await ada.delete();

    expect(await User.query().restore()).toBe(1);

    expect(await rowCount('users')).toBe(2);
    expect(await User.query().get()).toHaveLength(2);
    expect(await User.query().onlyTrashed().get()).toHaveLength(0);
  });

  it('excludes trashed rows from relation queries and eager loads', async () => {
    const user = await User.create({ name: 'Ada' });
    const hello = await user.posts().create({ title: 'Hello' });
    await user.posts().create({ title: 'World' });

    await hello.delete();

    // Lazy loading hides the trashed post
    const posts = await user.posts().getResults();
    expect(posts.map((p) => p.getAttribute('title'))).toEqual(['World']);

    // Eager loading hides it too
    const [loaded] = await User.query().with('posts').get();
    expect(loaded.getRelation('posts')).toHaveLength(1);

    // withTrashedRelations surfaces it
    const [withTrashed] = await User.query().withTrashedRelations().with('posts').get();
    const relation = withTrashed.getRelation('posts') as Post[];
    expect(relation).toHaveLength(2);
    expect(relation.some((p) => p.trashed())).toBe(true);

    // And the relation query itself can target trashed rows
    expect(await user.posts().onlyTrashed().getResults()).toHaveLength(1);
  });

  it('a belongsTo to a trashed parent returns nothing by default', async () => {
    const user = await User.create({ name: 'Ada' });
    const post = await user.posts().create({ title: 'Hello' });

    await user.delete();

    expect(await post.user().getResults()).toBeNull();
    expect(await post.user().withTrashed().getResults()).not.toBeNull();
  });

  it('keeps hard-delete behaviour for models without the flag', async () => {
    const page = await Page.create({ title: 'Home' });

    expect(await page.delete()).toBe(true);
    expect(await rowCount('pages')).toBe(0);
  });

  it('refresh() reads a trashed model back and keeps its state', async () => {
    const user = await User.create({ name: 'Ada' });
    await user.delete();

    await user.refresh();

    expect(user.trashed()).toBe(true);
    expect(user.getAttribute('name')).toBe('Ada');
  });
});
