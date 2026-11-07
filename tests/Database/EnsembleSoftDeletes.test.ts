/**
 * Ensemble soft delete tests
 *
 * Models opt in with `protected static softDeletes = true`. From then on
 * `delete()` stamps `deleted_at` instead of removing the row, every query
 * entry point (selects, aggregates, eager loads, relation queries) hides
 * trashed rows through the one `SoftDeletingScope`, and the builder's
 * `withTrashed` / `onlyTrashed` / `restore` / `forceDelete` methods ride the
 * same scope. The recording adapter pins the exact statements; the SQLite
 * integration suite proves the rows really persist.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { ObserverRegistry } from '@/Database/Ensemble/Observers';
import { SoftDeletingScope } from '@/Database/Ensemble/SoftDeletingScope';
import { recordAdapter, type ExecutedQuery } from './Query/support';

// ---------------------------------------------------------------------------
// Recording helpers
// ---------------------------------------------------------------------------

function useRecorder(results: Record<string, any> = {}): ExecutedQuery[] {
  const { adapter, queries } = recordAdapter(results);

  const manager = new DatabaseManager({
    default: 'test',
    connections: {
      test: { adapter: 'recording', driver: 'sqlite', database: ':memory:' },
    },
  });
  manager.registerAdapter('recording', () => adapter);
  Ensemble.setConnectionResolver(manager);

  return queries;
}

/**
 * A recorder whose SELECT statements consume queued row sets in call order,
 * so a parent query and its eager loads can return different fixtures.
 */
function useSelectQueue(queues: any[][]): ExecutedQuery[] {
  const { adapter, queries } = recordAdapter();
  const remaining = [...queues];

  (adapter.select as any).mockImplementation(async (sql: string, bindings: any[] = []) => {
    queries.push({ method: 'select', sql, bindings });
    return remaining.shift() ?? [];
  });

  const manager = new DatabaseManager({
    default: 'test',
    connections: {
      test: { adapter: 'recording', driver: 'sqlite', database: ':memory:' },
    },
  });
  manager.registerAdapter('recording', () => adapter);
  Ensemble.setConnectionResolver(manager);

  return queries;
}

/** A persisted, non-trashed user built without touching the database */
function persistedUser(id: number = 1): User {
  const user = new User({ id, name: 'Ada' }, true);
  user.exists = true;
  user.syncOriginalPublic();
  return user;
}

// ---------------------------------------------------------------------------
// Test models
// ---------------------------------------------------------------------------

class User extends Ensemble {
  static softDeletes = true;
  static fillable: string[] = ['name'];
  protected timestamps: boolean = false;

  getTable(): string {
    return 'users';
  }

  /** Expose syncOriginal for building fixture instances */
  syncOriginalPublic(): void {
    this.syncOriginal();
  }

  posts() {
    return this.hasMany(Post, 'user_id');
  }
}

class Post extends Ensemble {
  static softDeletes = true;
  static fillable: string[] = ['title', 'user_id'];
  protected timestamps: boolean = false;

  getTable(): string {
    return 'posts';
  }

  comments() {
    return this.hasMany(Comment, 'post_id');
  }

  user() {
    return this.belongsTo(User, 'user_id');
  }
}

class Comment extends Ensemble {
  static softDeletes = true;
  static fillable: string[] = ['body', 'post_id'];
  protected timestamps: boolean = false;

  getTable(): string {
    return 'comments';
  }
}

/**
 * Timestamped soft model: a soft delete touches `updated_at` alongside
 * `deleted_at`, the way Laravel's runSoftDelete does.
 */
class TimestampedUser extends Ensemble {
  static softDeletes = true;
  static fillable: string[] = ['name'];
  protected timestamps: boolean = true;

  getTable(): string {
    return 'timestamped_users';
  }
}

/**
 * A plain model. Without the flag it keeps hard-delete behaviour and its
 * queries never mention a deleted-at column.
 */
class Page extends Ensemble {
  static fillable: string[] = ['title'];
  protected timestamps: boolean = false;

  getTable(): string {
    return 'pages';
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let queries: ExecutedQuery[];

beforeEach(() => {
  queries = useRecorder({ insert: 1 });
});

afterEach(() => {
  ObserverRegistry.clear();
});

describe('Soft delete on the model', () => {
  it('stamps deleted_at and leaves the row in place instead of deleting it', async () => {
    const user = persistedUser();

    const deleted = await user.delete();

    expect(deleted).toBe(true);
    expect(queries.map((query) => query.method)).toEqual(['update']);
    expect(queries[0].sql).toBe('UPDATE "users" SET "deleted_at" = ? WHERE "id" = ?');
    expect(queries[0].bindings[0]).toBeInstanceOf(Date);
    expect(queries[0].bindings[1]).toBe(1);

    // The row still exists, so the instance keeps its identity
    expect(user.exists).toBe(true);
    expect(user.trashed()).toBe(true);
  });

  it('touches updated_at when the model timestamps', async () => {
    const user = new TimestampedUser({ id: 1, name: 'Ada' }, true);
    user.exists = true;

    await user.delete();

    expect(queries[0].sql).toBe('UPDATE "timestamped_users" SET "deleted_at" = ?, "updated_at" = ? WHERE "id" = ?');
    expect(queries[0].bindings[0]).toBeInstanceOf(Date);
    expect(queries[0].bindings[1]).toBeInstanceOf(Date);
  });

  it('fires deleting, softDeleting, softDeleted and deleted in order', async () => {
    const calls: string[] = [];
    User.observe({
      deleting: () => calls.push('deleting'),
      softDeleting: () => calls.push('softDeleting'),
      softDeleted: () => calls.push('softDeleted'),
      deleted: () => calls.push('deleted'),
    });

    await persistedUser().delete();

    expect(calls).toEqual(['deleting', 'softDeleting', 'softDeleted', 'deleted']);
  });

  it('never issues a hard DELETE for a soft delete', async () => {
    await persistedUser().delete();

    expect(queries.some((query) => query.method === 'delete')).toBe(false);
  });

  it('keeps hard-delete behaviour for models without the flag', async () => {
    expect(Page.query().toSql()).toBe('SELECT * FROM "pages"');

    const page = new Page({ id: 1, title: 'Home' }, true);
    page.exists = true;

    const deleted = await page.delete();

    expect(deleted).toBe(true);
    expect(page.exists).toBe(false);
    expect(queries[0].method).toBe('delete');
    expect(queries[0].sql).toBe('DELETE FROM "pages" WHERE "id" = ?');
  });

  it('halts the soft delete when deleting returns false', async () => {
    const user = persistedUser();
    User.observe({ deleting: () => false });

    expect(await user.delete()).toBe(false);
    expect(user.trashed()).toBe(false);
    expect(queries).toHaveLength(0);
  });
});

describe('Force delete and restore', () => {
  it('forceDelete issues a hard delete and fires its events', async () => {
    const user = persistedUser();
    const calls: string[] = [];

    User.observe({
      forceDeleting: () => calls.push('forceDeleting'),
      deleting: () => calls.push('deleting'),
      deleted: () => calls.push('deleted'),
      forceDeleted: () => calls.push('forceDeleted'),
    });

    const deleted = await user.forceDelete();

    expect(deleted).toBe(true);
    expect(user.exists).toBe(false);
    expect(queries[0].method).toBe('delete');
    expect(queries[0].sql).toBe('DELETE FROM "users" WHERE "id" = ?');
    expect(calls).toEqual(['forceDeleting', 'deleting', 'deleted', 'forceDeleted']);
  });

  it('halts forceDelete when forceDeleting returns false', async () => {
    const user = persistedUser();
    User.observe({ forceDeleting: () => false });

    expect(await user.forceDelete()).toBe(false);
    expect(user.exists).toBe(true);
    expect(queries).toHaveLength(0);
  });

  it('restore clears deleted_at, saves, and fires restoring/restored', async () => {
    const user = persistedUser();
    await user.delete();
    queries.length = 0;

    const calls: string[] = [];
    User.observe({ restoring: () => calls.push('restoring'), restored: () => calls.push('restored') });

    const restored = await user.restore();

    expect(restored).toBe(true);
    expect(user.trashed()).toBe(false);
    expect(calls).toEqual(['restoring', 'restored']);

    expect(queries[0].method).toBe('update');
    expect(queries[0].sql).toBe('UPDATE "users" SET "deleted_at" = ? WHERE "id" = ?');
    expect(queries[0].bindings[0]).toBeNull();
  });

  it('halts restore when restoring returns false', async () => {
    const user = persistedUser();
    await user.delete();

    User.observe({ restoring: () => false });
    queries.length = 0;

    expect(await user.restore()).toBe(false);
    expect(user.trashed()).toBe(true);
    expect(queries).toHaveLength(0);
  });

  it('hydrates deleted_at as a Date and reflects it in trashed()', async () => {
    const stamp = '2026-11-07T10:00:00.000Z';
    useSelectQueue([[{ id: 1, name: 'Ada', deleted_at: stamp }]]);

    const user = await User.query().withTrashed().first();

    expect(user).not.toBeNull();
    expect(user!.trashed()).toBe(true);
    expect(user!.getAttribute('deleted_at')).toBeInstanceOf(Date);
    expect((user!.getAttribute('deleted_at') as Date).toISOString()).toBe(stamp);

    useSelectQueue([[{ id: 2, name: 'Grace', deleted_at: null }]]);
    const alive = await User.query().withTrashed().first();
    expect(alive!.trashed()).toBe(false);
  });

  it('exposes the deleted-at column names', () => {
    const user = new User({ name: 'Ada' });

    expect(user.getDeletedAtColumn()).toBe('deleted_at');
    expect(user.getQualifiedDeletedAtColumn()).toBe('users.deleted_at');
    expect(user.usesSoftDeletes()).toBe(true);
    expect(new Page().usesSoftDeletes()).toBe(false);
  });

  it('refresh() reloads a trashed model with the exclusion lifted', async () => {
    const user = persistedUser();
    await user.delete();

    queries = useSelectQueue([[{ id: 1, name: 'Ada', deleted_at: '2026-11-07T10:00:00.000Z' }]]);

    await user.refresh();

    expect(user.trashed()).toBe(true);
    expect(queries[0].sql).toBe('SELECT * FROM "users" WHERE "id" = ? LIMIT 1');
    expect(queries[0].sql).not.toContain('deleted_at');
  });
});

describe('Querying trashed rows', () => {
  it('excludes trashed rows by default and includes them with withTrashed', async () => {
    await User.query().get();
    expect(queries[0].sql).toBe('SELECT * FROM "users" WHERE "users"."deleted_at" IS NULL');

    queries.length = 0;
    await User.query().withTrashed().get();
    expect(queries[0].sql).toBe('SELECT * FROM "users"');

    queries.length = 0;
    await User.query().withTrashed().withoutTrashed().get();
    expect(queries[0].sql).toBe('SELECT * FROM "users" WHERE "users"."deleted_at" IS NULL');
  });

  it('returns only trashed rows with onlyTrashed', async () => {
    await User.query().onlyTrashed().get();

    expect(queries[0].sql).toBe('SELECT * FROM "users" WHERE "users"."deleted_at" IS NOT NULL');
  });

  it('combines the scope with other constraints', async () => {
    await User.query().where('name', '=', 'Ada').get();
    expect(queries[0].sql).toBe('SELECT * FROM "users" WHERE "name" = ? AND "users"."deleted_at" IS NULL');

    queries.length = 0;
    await User.query().where('name', '=', 'Ada').onlyTrashed().get();
    expect(queries[0].sql).toBe('SELECT * FROM "users" WHERE "name" = ? AND "users"."deleted_at" IS NOT NULL');
  });

  it('applies the scope to counts and aggregates', async () => {
    const results = useRecorder({ select: [{ aggregate: 2 }] });

    await User.query().count();
    expect(results[0].sql).toBe(
      'SELECT *, COUNT(*) as aggregate FROM "users" WHERE "users"."deleted_at" IS NULL LIMIT 1'
    );

    results.length = 0;
    await User.query().withTrashed().count();
    expect(results[0].sql).toBe('SELECT *, COUNT(*) as aggregate FROM "users" LIMIT 1');

    results.length = 0;
    await User.query().onlyTrashed().count();
    expect(results[0].sql).toBe(
      'SELECT *, COUNT(*) as aggregate FROM "users" WHERE "users"."deleted_at" IS NOT NULL LIMIT 1'
    );
  });

  it('excludes trashed rows from find', async () => {
    await User.query().find(1);

    expect(queries[0].sql).toBe('SELECT * FROM "users" WHERE "id" = ? AND "users"."deleted_at" IS NULL LIMIT 1');
  });

  it('carries the trashed state across clones', async () => {
    const builder = User.query().onlyTrashed();
    await builder.clone().get();

    expect(queries[0].sql).toBe('SELECT * FROM "users" WHERE "users"."deleted_at" IS NOT NULL');
  });

  it('lets withoutGlobalScope opt out of the soft deleting scope', async () => {
    await User.query().withoutGlobalScope(SoftDeletingScope).get();
    expect(queries[0].sql).toBe('SELECT * FROM "users"');

    queries.length = 0;
    await User.query().withoutGlobalScope('SoftDeletingScope').get();
    expect(queries[0].sql).toBe('SELECT * FROM "users"');

    queries.length = 0;
    await User.query().withoutGlobalScopes().get();
    expect(queries[0].sql).toBe('SELECT * FROM "users"');
  });

  it('scopes update and delete statements by default', async () => {
    await User.query().update({ name: 'Ada' });
    expect(queries[0].sql).toBe('UPDATE "users" SET "name" = ? WHERE "users"."deleted_at" IS NULL');

    queries.length = 0;
    await User.query().delete();
    expect(queries[0].sql).toBe('DELETE FROM "users" WHERE "users"."deleted_at" IS NULL');
  });
});

describe('Builder restore and forceDelete', () => {
  it('restore clears deleted_at on trashed rows only', async () => {
    const recorder = useRecorder({ update: 2 });

    const count = await User.query().restore();

    expect(count).toBe(2);
    expect(recorder[0].method).toBe('update');
    expect(recorder[0].sql).toBe('UPDATE "users" SET "deleted_at" = ? WHERE "users"."deleted_at" IS NOT NULL');
    expect(recorder[0].bindings[0]).toBeNull();
  });

  it('forceDelete is a hard delete that includes trashed rows', async () => {
    await User.query().forceDelete();

    expect(queries[0].method).toBe('delete');
    expect(queries[0].sql).toBe('DELETE FROM "users"');
  });

  it('forceDelete respects an explicit onlyTrashed constraint', async () => {
    await User.query().onlyTrashed().forceDelete();

    expect(queries[0].method).toBe('delete');
    expect(queries[0].sql).toBe('DELETE FROM "users" WHERE "users"."deleted_at" IS NOT NULL');
  });
});

describe('Relations and eager loads', () => {
  it('applies the scope to lazily loaded relation queries', async () => {
    await persistedUser().posts().getResults();

    expect(queries[0].sql).toBe('SELECT * FROM "posts" WHERE "user_id" = ? AND "posts"."deleted_at" IS NULL');
  });

  it('applies the scope to eager loads of soft-deleting related models', async () => {
    queries = useSelectQueue([[{ id: 1, name: 'Ada' }], [{ id: 9, user_id: 1, title: 'Hello' }]]);

    const users = await User.query().with('posts').get();

    // both the users query and the posts eager load are scoped
    expect(queries[0].sql).toBe('SELECT * FROM "users" WHERE "users"."deleted_at" IS NULL');
    expect(queries[1].sql).toContain('FROM "posts"');
    expect(queries[1].sql).toContain('"posts"."deleted_at" IS NULL');

    const loaded = users[0].getRelation('posts');
    expect(loaded).toHaveLength(1);
  });

  it('lifts the exclusion on relation queries with withTrashedRelations', async () => {
    queries = useSelectQueue([[{ id: 1, name: 'Ada' }], [{ id: 9, user_id: 1, title: 'Hello' }]]);

    const users = await User.query().withTrashedRelations().with('posts').get();

    expect(queries[0].sql).toBe('SELECT * FROM "users" WHERE "users"."deleted_at" IS NULL');
    expect(queries[1].sql).toContain('FROM "posts"');
    expect(queries[1].sql).not.toContain('"posts"."deleted_at"');

    expect(users[0].getRelation('posts')).toHaveLength(1);
  });

  it('propagates withTrashedRelations to nested relations', async () => {
    queries = useSelectQueue([
      [{ id: 1, name: 'Ada' }],
      [{ id: 9, user_id: 1, title: 'Hello' }],
      [{ id: 12, post_id: 9, body: 'Nice' }],
    ]);

    await User.query().withTrashedRelations().with('posts.comments').get();

    expect(queries).toHaveLength(3);
    expect(queries[1].sql).not.toContain('"posts"."deleted_at"');
    expect(queries[2].sql).not.toContain('"comments"."deleted_at"');

    // And without the request, every relation level stays scoped
    queries = useSelectQueue([
      [{ id: 1, name: 'Ada' }],
      [{ id: 9, user_id: 1, title: 'Hello' }],
      [{ id: 12, post_id: 9, body: 'Nice' }],
    ]);

    await User.query().with('posts.comments').get();

    expect(queries[1].sql).toContain('"posts"."deleted_at" IS NULL');
    expect(queries[2].sql).toContain('"comments"."deleted_at" IS NULL');
  });

  it('applies the scope to belongsTo eager loads of a soft parent', async () => {
    queries = useSelectQueue([[{ id: 9, user_id: 1, title: 'Hello' }], [{ id: 1, name: 'Ada' }]]);

    await Post.query().with('user').get();

    expect(queries[1].sql).toContain('FROM "users"');
    expect(queries[1].sql).toContain('"users"."deleted_at" IS NULL');
  });
});
