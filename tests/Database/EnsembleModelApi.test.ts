/**
 * Ensemble model conveniences
 *
 * The ticket's promise is that the everyday Eloquent API is there without the
 * model growing a second persistence layer: every method here answers through
 * the builder or the connection, and the recording adapter makes that visible -
 * the statements a call produces are part of the assertion.
 *
 * The parts that only a real database can settle - an increment composed
 * against the stored value, a unique index deciding `createOrFirst` - are in
 * `EnsembleModelApiSqlite.test.ts`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { DatabaseAdapter } from '@/Database/Contracts/DatabaseAdapter';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { withDynamicRelations } from '@/Database/Ensemble/Concerns/HasDynamicRelations';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { EnsembleCollection } from '@/Database/Ensemble/EnsembleCollection';
import { recordAdapter, type ExecutedQuery } from './Query/support';

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

class User extends Ensemble {
  static fillable: string[] = ['name', 'email', 'votes'];
  protected timestamps: boolean = false;

  getTable(): string {
    return 'users';
  }

  posts() {
    return this.hasMany(Post, 'user_id');
  }
}

class Post extends Ensemble {
  static fillable: string[] = ['title', 'user_id'];
  protected timestamps: boolean = false;

  getTable(): string {
    return 'posts';
  }
}

/** Timestamps on, so `touch()` has a clock of its own to move. */
class Article extends Ensemble {
  static fillable: string[] = ['title'];

  getTable(): string {
    return 'articles';
  }
}

/** A guarded column and a hidden one, for mass assignment and serialization. */
class Account extends Ensemble {
  static fillable: string[] = ['name'];
  protected hidden: string[] = ['password'];
  protected timestamps: boolean = false;

  getTable(): string {
    return 'accounts';
  }

  getFullNameAttribute(): string {
    return `${this.getAttribute('name')} ${this.getAttribute('surname') ?? ''}`.trim();
  }
}

/** Only two columns ever serialize. */
class Whitelisted extends Ensemble {
  static fillable: string[] = ['id', 'name', 'secret'];
  protected visible: string[] = ['id', 'name'];
  protected timestamps: boolean = false;

  getTable(): string {
    return 'whitelisted';
  }
}

// ---------------------------------------------------------------------------
// Fixture plumbing
// ---------------------------------------------------------------------------

let queries: ExecutedQuery[];
let adapter: DatabaseAdapter;

function useRecorder(results: Partial<Record<ExecutedQuery['method'], any>> = {}): void {
  const recorder = recordAdapter(results);

  queries = recorder.queries;
  adapter = recorder.adapter;

  const manager = new DatabaseManager({
    default: 'test',
    connections: { test: { adapter: 'recording', driver: 'sqlite', database: ':memory:' } },
  });
  manager.registerAdapter('recording', () => adapter);
  Ensemble.setConnectionResolver(manager);
}

/**
 * An adapter whose insert is rejected by a unique index, with the row that
 * won the race waiting behind it in the selects.
 */
function useConflictAdapter(existing: Record<string, any>[]): void {
  const recorder = recordAdapter({ select: existing });

  queries = recorder.queries;
  adapter = recorder.adapter;

  adapter.insert = async (sql: string, bindings: any[]) => {
    queries.push({ method: 'insert', sql, bindings });

    throw new Error(`Query failed: UNIQUE constraint failed: users.email\nSQL: ${sql}`);
  };

  const manager = new DatabaseManager({
    default: 'test',
    connections: { test: { adapter: 'conflict', driver: 'sqlite', database: ':memory:' } },
  });
  manager.registerAdapter('conflict', () => adapter);
  Ensemble.setConnectionResolver(manager);
}

/** A row exactly as the query builder would hand it back. */
function row(attributes: Record<string, any>): Record<string, any> {
  return attributes;
}

/** A model that came out of the table: it exists and holds still. */
function persisted<T extends Ensemble>(model: T): T {
  model.exists = true;
  (model as any).syncOriginal();
  return model;
}

afterEach(() => {
  User.forgetObservers();
  Post.forgetObservers();
});

// ===========================================================================
// Static conveniences
// ===========================================================================

describe('Ensemble – find-or-create conveniences', () => {
  it('firstOrCreate hands back the row that is already there', async () => {
    useRecorder({ select: [row({ id: 1, name: 'Ada', email: 'ada@example.com' })] });

    const user = await User.firstOrCreate({ email: 'ada@example.com' }, { name: 'Ada' });

    expect(user.getKey()).toBe(1);
    expect(user.getAttribute('name')).toBe('Ada');
    // Nothing to write: the search was the only statement that ran.
    expect(queries.map((query) => query.method)).toEqual(['select']);
    expect(queries[0].sql).toContain('WHERE "email" = ?');
    expect(queries[0].bindings).toEqual(['ada@example.com']);
  });

  it('firstOrCreate writes the merge of search and values when there is no row', async () => {
    useRecorder({ select: [], insert: 7 });

    const user = await User.firstOrCreate({ email: 'grace@example.com' }, { name: 'Grace' });

    expect(user.exists).toBe(true);
    expect(user.getKey()).toBe(7);
    expect(user.getAttribute('name')).toBe('Grace');
    expect(user.getAttribute('email')).toBe('grace@example.com');

    const insert = queries.find((query) => query.method === 'insert');
    expect(insert?.sql).toBe('INSERT INTO "users" ("email", "name") VALUES (?, ?)');
    // Both halves of the merge reach the table: search and values together.
    expect(insert?.bindings).toEqual(['grace@example.com', 'Grace']);
  });

  it('updateOrCreate fills the row it found, as it always did', async () => {
    useRecorder({ select: [row({ id: 1, name: 'Ada', email: 'ada@example.com' })], update: 1 });

    const user = await User.updateOrCreate({ email: 'ada@example.com' }, { name: 'Augusta' });

    expect(user.getAttribute('name')).toBe('Augusta');
    expect(queries.map((query) => query.method)).toEqual(['select', 'update']);
    expect(queries[1].sql).toBe('UPDATE "users" SET "name" = ? WHERE "id" = ?');
    expect(queries[1].bindings).toEqual(['Augusta', 1]);
  });

  it('updateOrCreate creates when the search comes up empty', async () => {
    useRecorder({ select: [], insert: 3 });

    const user = await User.updateOrCreate({ email: 'new@example.com' }, { name: 'New' });

    expect(user.getKey()).toBe(3);
    expect(queries.map((query) => query.method)).toEqual(['select', 'insert']);
  });

  it('createOrFirst writes first, and reads the winner when the index refuses', async () => {
    useConflictAdapter([row({ id: 9, name: 'Ada', email: 'ada@example.com' })]);

    const user = await User.createOrFirst({ email: 'ada@example.com' }, { name: 'Ada' });

    expect(user.getKey()).toBe(9);
    expect(queries.map((query) => query.method)).toEqual(['insert', 'select']);
  });

  it('createOrFirst lets a failure that is not a conflict through', async () => {
    const recorder = recordAdapter();

    queries = recorder.queries;
    adapter = recorder.adapter;

    adapter.insert = async (sql: string) => {
      throw new Error(`Query failed: table users has no column named nope\nSQL: ${sql}`);
    };

    const manager = new DatabaseManager({
      default: 'test',
      connections: { test: { adapter: 'broken', driver: 'sqlite', database: ':memory:' } },
    });
    manager.registerAdapter('broken', () => adapter);
    Ensemble.setConnectionResolver(manager);

    await expect(User.createOrFirst({ email: 'ada@example.com' })).rejects.toThrow('no column named nope');
  });

  it('firstOrNew builds the model but leaves the saving to the caller', async () => {
    useRecorder({ select: [] });

    const user = await User.firstOrNew({ email: 'ada@example.com' }, { name: 'Ada' });

    expect(user.exists).toBe(false);
    expect(user.getAttribute('email')).toBe('ada@example.com');
    expect(user.getAttribute('name')).toBe('Ada');
    expect(queries.map((query) => query.method)).toEqual(['select']);
  });

  it('firstOrNew hands back the row that was found', async () => {
    useRecorder({ select: [row({ id: 1, name: 'Ada' })] });

    const user = await User.firstOrNew({ name: 'Ada' });

    expect(user.exists).toBe(true);
    expect(user.getKey()).toBe(1);
  });

  it('findOrNew keeps the key it looked for', async () => {
    useRecorder({ select: [] });

    const user = await User.findOrNew(42);

    expect(user.exists).toBe(false);
    expect(user.getKey()).toBe(42);
  });

  it('findOrNew returns the model when the key is in the table', async () => {
    useRecorder({ select: [row({ id: 42, name: 'Ada' })] });

    const user = await User.findOrNew(42);

    expect(user.exists).toBe(true);
    expect(user.getAttribute('name')).toBe('Ada');
  });

  it('sole returns the one row', async () => {
    useRecorder({ select: [row({ id: 1, name: 'Ada' })] });

    const user = await User.sole();

    expect(user.getAttribute('name')).toBe('Ada');
    // Two rows are read so an ambiguous query can be named as such.
    expect(queries[0].sql).toContain('LIMIT 2');
  });

  it('sole refuses no row and more than one', async () => {
    useRecorder({ select: [] });
    await expect(User.sole()).rejects.toThrow('No query results for model [User]');

    useRecorder({ select: [row({ id: 1 }), row({ id: 2 })] });
    await expect(User.sole()).rejects.toThrow('more than one result');
  });

  it('firstWhere searches one column', async () => {
    useRecorder({ select: [row({ id: 4, name: 'Ada' })] });

    const user = await User.firstWhere('name', 'Ada');

    expect(user?.getKey()).toBe(4);
    expect(queries[0].sql).toBe('SELECT * FROM "users" WHERE "name" = ? LIMIT 1');
    expect(queries[0].bindings).toEqual(['Ada']);
  });

  it('value and pluck read columns through the model', async () => {
    useRecorder({ select: [row({ name: 'Ada' }), row({ name: 'Grace' })] });

    expect(await User.value('name')).toBe('Ada');
    expect(await User.pluck('name')).toEqual(['Ada', 'Grace']);
    expect(queries[0].sql).toBe('SELECT "name" FROM "users" LIMIT 1');
    expect(queries[1].sql).toBe('SELECT "name" FROM "users"');
  });

  it('value answers nothing when there is no row', async () => {
    useRecorder({ select: [] });

    expect(await User.value('name')).toBeNull();
  });

  it('destroy walks the keys and deletes model by model', async () => {
    useRecorder({ select: [row({ id: 1, name: 'Ada' }), row({ id: 2, name: 'Grace' })], delete: 1 });

    const deleted = await User.destroy(1, 2);

    expect(deleted).toBe(2);
    expect(queries[0].sql).toBe('SELECT * FROM "users" WHERE "id" IN (?, ?)');
    expect(queries.filter((query) => query.method === 'delete')).toHaveLength(2);
  });

  it('destroy counts nothing when no key matches', async () => {
    useRecorder({ select: [] });

    expect(await User.destroy([99])).toBe(0);
    expect(queries.filter((query) => query.method === 'delete')).toHaveLength(0);
  });

  it('truncate empties the table', async () => {
    useRecorder();

    await User.truncate();

    expect(queries[0].sql).toBe('DELETE FROM "users"');
  });
});

// ===========================================================================
// Instance conveniences
// ===========================================================================

describe('Ensemble – increment and decrement', () => {
  it('moves the column in the table and in memory', async () => {
    useRecorder({ update: 1 });

    const user = persisted(new User({ id: 1, votes: 3 }, true));

    await user.increment('votes', 2);

    expect(user.getAttribute('votes')).toBe(5);
    // The database does the arithmetic, so a concurrent writer adds to the
    // same total instead of being overwritten.
    expect(queries[0].sql).toBe('UPDATE "users" SET "votes" = "votes" + ? WHERE "id" = ?');
    expect(queries[0].bindings).toEqual([2, 1]);
  });

  it('defaults to one and subtracts on the other side', async () => {
    useRecorder({ update: 1 });

    const user = persisted(new User({ id: 1, votes: 3 }, true));

    await user.increment('votes');
    await user.decrement('votes', 2);

    expect(user.getAttribute('votes')).toBe(2);
    expect(queries[0].sql).toContain('"votes" = "votes" + ?');
    expect(queries[1].sql).toBe('UPDATE "users" SET "votes" = "votes" - ? WHERE "id" = ?');
    expect(queries[1].bindings).toEqual([2, 1]);
  });

  it('writes extra columns alongside the arithmetic', async () => {
    useRecorder({ update: 1 });

    const user = persisted(new User({ id: 1, votes: 1 }, true));

    await user.increment('votes', 1, { name: 'Grace' });

    expect(user.getAttribute('name')).toBe('Grace');
    expect(queries[0].sql).toBe('UPDATE "users" SET "votes" = "votes" + ?, "name" = ? WHERE "id" = ?');
    expect(queries[0].bindings).toEqual([1, 'Grace', 1]);
  });

  it('stamps updated_at, because the row really did change', async () => {
    useRecorder({ update: 1 });

    const article = persisted(new Article({ id: 1, votes: 0 }, true));

    await article.increment('votes');

    expect(queries[0].sql).toBe('UPDATE "articles" SET "votes" = "votes" + ?, "updated_at" = ? WHERE "id" = ?');
    expect(article.getAttribute('updated_at')).toBeInstanceOf(Date);
  });

  it('syncs only the columns it wrote, leaving other edits dirty', async () => {
    useRecorder({ update: 1 });

    const user = persisted(new User({ id: 1, votes: 1, name: 'Ada' }, true));
    user.setAttribute('name', 'Augusta');

    await user.increment('votes');

    expect(user.isDirty('votes')).toBe(false);
    expect(user.isDirty('name')).toBe(true);
  });

  it('fires the update half of the lifecycle', async () => {
    useRecorder({ update: 1 });

    const events: string[] = [];
    User.observe({
      saving: () => void events.push('saving'),
      updating: () => void events.push('updating'),
      updated: () => void events.push('updated'),
      saved: () => void events.push('saved'),
    });

    await persisted(new User({ id: 1, votes: 1 }, true)).increment('votes');

    // A column bump is an update, not a full save.
    expect(events).toEqual(['updating', 'updated']);
  });

  it('lets an observer cancel the move', async () => {
    useRecorder({ update: 1 });
    User.observe({ updating: () => false });

    const user = persisted(new User({ id: 1, votes: 1 }, true));

    await user.decrement('votes');

    expect(user.getAttribute('votes')).toBe(1);
    expect(queries).toHaveLength(0);
  });

  it('fills an unsaved model instead of writing to no row', async () => {
    useRecorder({ insert: 4 });

    const user = new User({ name: 'Ada', votes: 1 });

    await user.increment('votes', 2);

    expect(user.getAttribute('votes')).toBe(3);
    expect(user.exists).toBe(true);
    expect(queries.map((query) => query.method)).toEqual(['insert']);
  });
});

describe('Ensemble – touch', () => {
  it('writes updated_at and nothing else', async () => {
    useRecorder({ update: 1 });

    const article = persisted(new Article({ id: 1, title: 'Hello' }, true));
    article.setAttribute('title', 'Pending');

    expect(await article.touch()).toBe(true);
    expect(queries[0].sql).toBe('UPDATE "articles" SET "updated_at" = ? WHERE "id" = ?');
    expect(queries[0].bindings).toHaveLength(2);
    // The edit nobody asked to write is still nobody's.
    expect(article.isDirty('title')).toBe(true);
  });

  it('stamps the columns it is given', async () => {
    useRecorder({ update: 1 });

    const article = persisted(new Article({ id: 1 }, true));

    await article.touch(['created_at', 'updated_at']);

    expect(queries[0].sql).toBe('UPDATE "articles" SET "created_at" = ?, "updated_at" = ? WHERE "id" = ?');
  });

  it('does nothing while timestamps are suppressed', async () => {
    useRecorder({ update: 1 });

    const article = persisted(new Article({ id: 1 }, true));

    await article.withoutTimestamps(async (model) => {
      expect(await model.touch()).toBe(false);
    });

    expect(article.getAttribute('updated_at')).toBeUndefined();
    expect(queries).toHaveLength(0);
  });

  it('puts the timestamps back after the callback', async () => {
    useRecorder({ update: 1 });

    const article = persisted(new Article({ id: 1 }, true));

    await article.withoutTimestamps(() => Promise.resolve());
    await article.touch();

    expect(queries).toHaveLength(1);
  });

  it('has no row to stamp on an unsaved model', async () => {
    useRecorder({ update: 1 });

    expect(await new Article({ title: 'Draft' }).touch()).toBe(false);
    expect(queries).toHaveLength(0);
  });
});

describe('Ensemble – replicate', () => {
  it('copies everything but the identity and the excluded columns', () => {
    useRecorder();

    const user = persisted(new User({ id: 1, name: 'Ada', email: 'ada@example.com' }, true));

    const copy = user.replicate(['email']);

    expect(copy.exists).toBe(false);
    expect(copy.getKey()).toBeUndefined();
    expect(copy.getAttribute('name')).toBe('Ada');
    expect(copy.getAttribute('email')).toBeUndefined();
    expect(queries).toHaveLength(0);
  });

  it('starts a new clock rather than inheriting the old one', () => {
    useRecorder();

    const article = persisted(new Article({ id: 1, created_at: new Date(), updated_at: new Date() }, true));

    const copy = article.replicate();

    expect(copy.getAttribute('created_at')).toBeUndefined();
    expect(copy.getAttribute('updated_at')).toBeUndefined();
  });

  it('carries the loaded relations and the attributes guarded away', () => {
    useRecorder();

    const post = persisted(new Post({ id: 1, title: 'Hello' }, true));
    const user = persisted(new User({ id: 1, name: 'Ada' }, true));
    user.setRelation('posts', [post]);

    const copy = user.replicate();

    expect(copy.getRelation('posts')).toEqual([post]);
    expect(copy.getAttribute('name')).toBe('Ada');
  });

  it('writes the copy as its own row', async () => {
    useRecorder({ insert: 2 });

    const user = persisted(new User({ id: 1, name: 'Ada', email: 'ada@example.com' }, true));

    const copy = user.replicate(['email']);
    await copy.save();

    expect(copy.exists).toBe(true);
    expect(copy.getKey()).toBe(2);
    expect(queries[0].sql).toBe('INSERT INTO "users" ("name") VALUES (?)');
    expect(queries[0].bindings).toEqual(['Ada']);
  });
});

describe('Ensemble – is and isNot', () => {
  it('compares class and key, not object identity', () => {
    const a = persisted(new User({ id: 1, name: 'Ada' }, true));
    const b = persisted(new User({ id: 1, name: 'Someone else' }, true));
    const post = persisted(new Post({ id: 1, title: 'Hello' }, true));

    expect(a.is(b)).toBe(true);
    expect(a.is(a)).toBe(true);
    expect(a.isNot(b)).toBe(false);
    expect(a.is(post)).toBe(false);
    expect(a.isNot(post)).toBe(true);
  });

  it('never calls two unsaved models the same', () => {
    expect(new User({ name: 'Ada' }).is(new User({ name: 'Ada' }))).toBe(false);
  });
});

describe('Ensemble – fresh', () => {
  it('reads the row into a separate instance', async () => {
    useRecorder({ select: [row({ id: 1, name: 'From the table' })] });

    const user = persisted(new User({ id: 1, name: 'Stale' }, true));

    const reloaded = await user.fresh();

    expect(reloaded).not.toBe(user);
    expect(reloaded?.getAttribute('name')).toBe('From the table');
    expect(user.getAttribute('name')).toBe('Stale');
    expect(queries[0].sql).toBe('SELECT * FROM "users" WHERE "id" = ? LIMIT 1');
  });

  it('selects only the columns it is asked for', async () => {
    useRecorder({ select: [row({ id: 1, name: 'Ada' })] });

    const user = persisted(new User({ id: 1, name: 'Stale' }, true));

    await user.fresh(['name']);

    expect(queries[0].sql).toContain('SELECT "name" FROM');
  });

  it('has nothing to read for a model that was never written', async () => {
    useRecorder();

    expect(await new User({ name: 'Ada' }).fresh()).toBeNull();
    expect(queries).toHaveLength(0);
  });
});

describe('Ensemble – saveOrFail', () => {
  it('writes inside a transaction', async () => {
    useRecorder({ insert: 2 });

    expect(await new User({ name: 'Ada' }).saveOrFail()).toBe(true);

    expect(adapter.beginTransaction).toHaveBeenCalled();
    expect(adapter.commit).toHaveBeenCalled();
    expect(adapter.rollback).not.toHaveBeenCalled();
    expect(queries.map((query) => query.method)).toEqual(['insert']);
  });

  it('turns a cancelled save into an exception', async () => {
    useRecorder({ insert: 2 });
    User.observe({ saving: () => false });

    await expect(new User({ name: 'Ada' }).saveOrFail()).rejects.toThrow('cancelled by a model event');

    expect(adapter.rollback).toHaveBeenCalled();
    expect(queries).toHaveLength(0);
  });
});

describe('Ensemble – push', () => {
  it('saves the loaded relations too', async () => {
    useRecorder({ insert: 5, update: 1 });

    const user = new User({ name: 'Ada' });
    const post = persisted(new Post({ id: 1, title: 'Draft' }, true));
    post.setAttribute('title', 'Published');
    user.setRelation('posts', [post]);

    expect(await user.push()).toBe(true);
    expect(user.exists).toBe(true);
    // Parent first, so the child has a row to hang on to.
    expect(queries.map((query) => query.method)).toEqual(['insert', 'update']);
  });

  it('stops at the first relation that refuses to write', async () => {
    useRecorder({ insert: 5, update: 1 });
    Post.observe({ saving: () => false });

    const user = new User({ name: 'Ada' });
    user.setRelation('posts', [persisted(new Post({ id: 1, title: 'Blocked' }, true))]);

    expect(await user.push()).toBe(false);
    expect(queries.map((query) => query.method)).toEqual(['insert']);
  });

  it('does not chase a relation that points back', async () => {
    useRecorder({ update: 1 });

    const user = persisted(new User({ id: 1, name: 'Ada' }, true));
    const post = persisted(new Post({ id: 1, user_id: 1 }, true));
    user.setAttribute('name', 'Augusta');
    post.setAttribute('title', 'Published');
    user.setRelation('posts', new EnsembleCollection([post]));
    post.setRelation('user', user);

    expect(await user.push()).toBe(true);
    // One write for the parent, one for the child: the cycle broke.
    expect(queries.filter((query) => query.method === 'update')).toHaveLength(2);
  });
});

describe('Ensemble – unguard and reguard', () => {
  it('lets a guarded column through for the length of the callback', async () => {
    useRecorder();

    const account = new Account({ name: 'Ada' });

    expect(account.fill({ is_admin: true }).getAttribute('is_admin')).toBeUndefined();

    await account.unguard((model) => {
      expect(model.fill({ is_admin: true }).getAttribute('is_admin')).toBe(true);
    });

    // Back under the lists, so the same key is refused again.
    expect(account.fill({ is_admin: false }).getAttribute('is_admin')).toBe(true);
  });

  it('restores the lists even when the callback throws', async () => {
    useRecorder();

    const account = new Account();

    await expect(
      account.unguard(() => {
        throw new Error('mid-write');
      })
    ).rejects.toThrow('mid-write');

    expect(account.fill({ is_admin: true }).getAttribute('is_admin')).toBeUndefined();
  });

  it('reguard closes what unguard opened', async () => {
    useRecorder();

    const account = new Account();

    await account.unguard((model) => {
      model.reguard();

      expect(model.fill({ is_admin: true }).getAttribute('is_admin')).toBeUndefined();
    });
  });
});

describe('Ensemble – preventLazyLoading and shouldBeStrict', () => {
  it('turns an unloaded relation read into an error', async () => {
    useRecorder();

    const user = persisted(new User({ id: 1, name: 'Ada' }, true));
    user.preventLazyLoading();

    await expect(user.load('posts')).rejects.toThrow(
      'Lazy loading violation: the [User] model attempted to lazy load the [posts] relation'
    );
    // The point is the query that never went out.
    expect(queries).toHaveLength(0);
  });

  it('leaves a relation that is already loaded alone', async () => {
    useRecorder();

    const post = persisted(new Post({ id: 1, title: 'Hello' }, true));
    const user = persisted(new User({ id: 1 }, true));
    user.setRelation('posts', [post]);
    user.preventLazyLoading();

    await user.load('posts');

    expect(queries).toHaveLength(0);
    expect(user.getRelation('posts')).toEqual([post]);
  });

  it('guards the dynamic property read as well', async () => {
    useRecorder({ select: [row({ id: 1, user_id: 1, title: 'Hello' })] });

    class DynamicUser extends User {
      protected dynamicRelations: boolean = true;
    }

    const guarded = withDynamicRelations(persisted(new DynamicUser({ id: 1 }, true)));
    guarded.preventLazyLoading();

    // The read is the lazy load, so that is what the guard answers.
    await expect(Promise.resolve(guarded.posts)).rejects.toThrow('Lazy loading violation');
    expect(queries).toHaveLength(0);

    const eager = withDynamicRelations(persisted(new DynamicUser({ id: 1 }, true)));

    expect((await eager.posts).length).toBe(1);
    // And the relation is cached on the model, the way `load()` leaves it.
    expect(eager.relationLoaded('posts')).toBe(true);
  });

  it('strict mode reports the attribute it refuses', () => {
    useRecorder();

    const account = new Account();
    account.shouldBeStrict();

    expect(() => account.fill({ name: 'Ada', is_admin: true })).toThrow(
      'This [Account] does not allow [is_admin] to be mass assigned.'
    );
  });

  it('strict mode switches lazy loading on and off with it', async () => {
    useRecorder({ select: [row({ id: 1, user_id: 1, title: 'Hello' })] });

    const user = persisted(new User({ id: 1 }, true));
    user.shouldBeStrict();

    await expect(user.load('posts')).rejects.toThrow('Lazy loading violation');

    user.shouldBeStrict(false);

    await user.load('posts');

    expect(user.relationLoaded('posts')).toBe(true);
  });
});

describe('Ensemble – withoutEvents', () => {
  it('holds the lifecycle back for the length of the callback', async () => {
    useRecorder({ insert: 1 });

    const events: string[] = [];
    User.observe({
      creating: () => void events.push('creating'),
      created: () => void events.push('created'),
      saving: () => void events.push('saving'),
    });

    await new User({ name: 'Quiet' }).withoutEvents(async (model) => {
      await model.save();
    });

    expect(events).toEqual([]);
    // The write itself is not suppressed.
    expect(queries.map((query) => query.method)).toEqual(['insert']);

    await new User({ name: 'Loud' }).save();

    expect(events).toEqual(['saving', 'creating', 'created']);
  });
});

// ===========================================================================
// Serialization helpers
// ===========================================================================

describe('Ensemble – serialization helpers', () => {
  it('makeHidden takes an attribute out of the serialized form', () => {
    useRecorder();

    const user = persisted(new User({ id: 1, name: 'Ada', email: 'ada@example.com' }, true));

    expect(user.makeHidden('email')).toBe(user);
    expect(user.toObject()).toEqual({ id: 1, name: 'Ada' });
    expect(user.toJSON()).toEqual({ id: 1, name: 'Ada' });
  });

  it('makeVisible puts a hidden attribute back', () => {
    useRecorder();

    const account = new Account();
    account.setRawAttributes({ id: 1, name: 'Ada', password: 'secret' });

    expect(account.toObject()).toEqual({ id: 1, name: 'Ada' });

    account.makeVisible('password');

    expect(account.toObject()).toEqual({ id: 1, name: 'Ada', password: 'secret' });
  });

  it('makeVisible extends a whitelist instead of dissolving it', () => {
    useRecorder();

    const model = new Whitelisted();
    model.setRawAttributes({ id: 1, name: 'Ada', secret: 'shh' });

    expect(model.toObject()).toEqual({ id: 1, name: 'Ada' });

    model.makeVisible('secret');

    expect(model.toObject()).toEqual({ id: 1, name: 'Ada', secret: 'shh' });
  });

  it('makeHidden wins over the list of what to show', () => {
    useRecorder();

    const model = new Whitelisted();
    model.setRawAttributes({ id: 1, name: 'Ada', secret: 'shh' });

    model.makeHidden('name');

    expect(model.toObject()).toEqual({ id: 1 });
  });

  it('append and setAppends drive the accessors', () => {
    useRecorder();

    const account = new Account();
    account.setRawAttributes({ id: 1, name: 'Ada', surname: 'Lovelace' });

    expect(account.getAppends()).toEqual([]);

    expect(account.append('full_name')).toBe(account);
    expect(account.toObject().full_name).toBe('Ada Lovelace');

    account.setAppends([]);
    expect(account.getAppends()).toEqual([]);
    expect(account.toObject().full_name).toBeUndefined();

    account.setAppends('full_name');
    expect(account.getAppends()).toEqual(['full_name']);
    expect(account.toObject().full_name).toBe('Ada Lovelace');
  });

  it('only and except filter the form the model already has', () => {
    useRecorder();

    const user = persisted(new User({ id: 1, name: 'Ada', email: 'ada@example.com' }, true));

    expect(user.only(['name', 'nope'])).toEqual({ name: 'Ada' });
    expect(user.except(['email'])).toEqual({ id: 1, name: 'Ada' });
  });

  it('getOriginal answers with the stored values, whole or singly', () => {
    useRecorder();

    const user = persisted(new User({ id: 1, name: 'Ada' }, true));
    user.setAttribute('name', 'Augusta');

    expect(user.getOriginal('name')).toBe('Ada');
    expect(user.getOriginal()).toEqual({ id: 1, name: 'Ada' });
    expect(user.getAttribute('name')).toBe('Augusta');
  });

  it('getChanges and wasChanged report the last write, not the pending one', async () => {
    useRecorder({ insert: 3, update: 1 });

    const user = new User({ name: 'Ada' });

    expect(user.isClean()).toBe(false);
    expect(user.wasChanged()).toBe(false);

    await user.save();

    expect(user.getChanges()).toEqual({ name: 'Ada' });
    expect(user.wasChanged('name')).toBe(true);
    expect(user.isClean()).toBe(true);

    user.setAttribute('name', 'Augusta');
    expect(user.getDirty()).toEqual({ name: 'Augusta' });
    // Still true from the previous write, while the new one waits.
    expect(user.wasChanged('name')).toBe(true);
    expect(user.isClean('name')).toBe(false);

    await user.save();

    expect(user.getChanges()).toEqual({ name: 'Augusta' });
    expect(user.wasChanged(['email', 'name'])).toBe(true);
    expect(user.isClean(['email', 'name'])).toBe(true);
  });

  it('isClean is true for a model that was read and not touched', () => {
    useRecorder();

    const user = persisted(new User({ id: 1, name: 'Ada' }, true));

    expect(user.isClean()).toBe(true);
    expect(user.isClean('name')).toBe(true);
    expect(user.wasChanged()).toBe(false);
    expect(user.getChanges()).toEqual({});
  });
});
