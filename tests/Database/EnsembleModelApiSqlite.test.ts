/**
 * Ensemble model conveniences against a real SQLite database
 *
 * The unit suite pins the compiled statements; this one proves the promises
 * the ticket makes about behaviour: the arithmetic really is composed by the
 * database, a unique index really does decide `createOrFirst`, and a copy
 * really does land in the table as its own row.
 *
 * better-sqlite3 is an optional dependency (and needs a native build), so the
 * integration suite only runs when the driver is actually installed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DrizzleAdapter } from '@/Database/Adapters/DrizzleAdapter';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { WITH_BETTER_SQLITE } from './support';

const SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    votes INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    views INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
  );
`;

class User extends Ensemble {
  static fillable: string[] = ['name', 'email', 'votes'];

  getTable(): string {
    return 'users';
  }

  posts() {
    return this.hasMany(Post, 'user_id');
  }
}

class Post extends Ensemble {
  static fillable: string[] = ['user_id', 'title', 'views'];

  getTable(): string {
    return 'posts';
  }

  user() {
    return this.belongsTo(User, 'user_id');
  }
}

async function count(table: string): Promise<number> {
  const rows = await adapter.select<{ count: number }>(`SELECT COUNT(*) as count FROM ${table}`);

  return rows[0].count;
}

async function column(table: string, column: string, id: number): Promise<any> {
  const rows = await adapter.select<Record<string, any>>(`SELECT ${column} FROM ${table} WHERE id = ?`, [id]);

  return rows[0]?.[column];
}

let adapter: DrizzleAdapter;

describe.skipIf(!WITH_BETTER_SQLITE)('Ensemble model conveniences (better-sqlite3)', () => {
  beforeEach(async () => {
    adapter = new DrizzleAdapter({ driver: 'better-sqlite3', database: ':memory:' });
    await adapter.connect();

    for (const statement of SCHEMA.split(';').filter((statement) => statement.trim() !== '')) {
      await adapter.query(statement);
    }

    const manager = new DatabaseManager({
      default: 'main',
      connections: { main: { adapter: 'drizzle', driver: 'better-sqlite3', database: ':memory:' } },
    });
    manager.registerAdapter('drizzle', () => adapter);
    Ensemble.setConnectionResolver(manager);
  });

  afterEach(async () => {
    await adapter.disconnect();
    User.forgetObservers();
  });

  // -------------------------------------------------------------------------
  // Static conveniences
  // -------------------------------------------------------------------------

  it('firstOrCreate returns the existing row, then the one it wrote', async () => {
    const created = await User.firstOrCreate({ email: 'ada@example.com' }, { name: 'Ada' });

    expect(created.exists).toBe(true);
    expect(created.getKey()).toBeDefined();
    expect(await count('users')).toBe(1);

    const again = await User.firstOrCreate({ email: 'ada@example.com' }, { name: 'Someone else' });

    // The search matched, so nothing was written and nothing was changed.
    expect(again.getKey()).toBe(created.getKey());
    expect(again.getAttribute('name')).toBe('Ada');
    expect(await count('users')).toBe(1);
  });

  it('updateOrCreate writes the values onto the row it found', async () => {
    await User.create({ email: 'ada@example.com', name: 'Ada' });

    const updated = await User.updateOrCreate({ email: 'ada@example.com' }, { name: 'Augusta' });

    expect(await column('users', 'name', updated.getKey())).toBe('Augusta');
    expect(await count('users')).toBe(1);

    const created = await User.updateOrCreate({ email: 'grace@example.com' }, { name: 'Grace' });

    expect(created.exists).toBe(true);
    expect(await count('users')).toBe(2);
  });

  it('createOrFirst returns the row behind the unique index it collided with', async () => {
    const written = await User.create({ email: 'ada@example.com', name: 'Ada' });

    const raced = await User.createOrFirst({ email: 'ada@example.com' }, { name: 'Duplicate' });

    expect(raced.getKey()).toBe(written.getKey());
    expect(raced.getAttribute('name')).toBe('Ada');
    expect(await count('users')).toBe(1);
  });

  it('createOrFirst writes the row when nothing is in the way', async () => {
    const created = await User.createOrFirst({ email: 'grace@example.com' }, { name: 'Grace' });

    expect(created.getAttribute('name')).toBe('Grace');
    expect(await count('users')).toBe(1);
  });

  it('firstOrNew leaves the built model out of the table', async () => {
    const built = await User.firstOrNew({ email: 'ada@example.com' }, { name: 'Ada' });

    expect(built.exists).toBe(false);
    expect(await count('users')).toBe(0);

    await built.save();

    expect(await count('users')).toBe(1);
  });

  it('findOrNew returns the row or a model carrying the key it asked for', async () => {
    const created = await User.create({ email: 'ada@example.com', name: 'Ada' });

    expect((await User.findOrNew(created.getKey())).exists).toBe(true);

    const fresh = await User.findOrNew(4242);

    expect(fresh.exists).toBe(false);
    expect(fresh.getKey()).toBe(4242);
    expect(await count('users')).toBe(1);
  });

  it('sole answers exactly one row and complains about the rest', async () => {
    // Nothing to read yet, and exactly one row after the create.
    await expect(User.sole()).rejects.toThrow('No query results');

    const created = await User.create({ email: 'ada@example.com', name: 'Ada' });

    expect((await User.sole()).getKey()).toBe(created.getKey());
    expect((await User.query().where('id', '=', created.getKey()).sole()).getKey()).toBe(created.getKey());

    await User.create({ email: 'grace@example.com', name: 'Grace' });
    await expect(User.query().sole()).rejects.toThrow('more than one result');
  });

  it('firstWhere, value, pluck and the builder paths agree', async () => {
    await User.create({ email: 'ada@example.com', name: 'Ada' });
    await User.create({ email: 'grace@example.com', name: 'Grace' });

    expect((await User.firstWhere('email', 'grace@example.com'))?.getAttribute('name')).toBe('Grace');
    expect(await User.firstWhere('email', 'nobody@example.com')).toBeNull();

    expect(await User.value('name')).toBe('Ada');
    expect(await User.query().where('email', '=', 'grace@example.com').value('name')).toBe('Grace');
    expect(await User.pluck('email')).toEqual(['ada@example.com', 'grace@example.com']);
  });

  it('pluck and value carry the model casts, not just the raw column', async () => {
    await User.create({ email: 'ada@example.com', name: 'Ada', votes: 7 });

    // SQLite hands back a number for an INTEGER column; the model reads it
    // through the same accessor the attribute would use.
    expect(await User.query().where('name', '=', 'Ada').value('votes')).toBe(7);
  });

  it('destroy deletes the keyed rows and reports how many went', async () => {
    const ada = await User.create({ email: 'ada@example.com', name: 'Ada' });
    const grace = await User.create({ email: 'grace@example.com', name: 'Grace' });
    await User.create({ email: 'alan@example.com', name: 'Alan' });

    const deleted = await User.destroy([ada.getKey(), grace.getKey()]);

    expect(deleted).toBe(2);
    expect(await count('users')).toBe(1);
  });

  it('destroy fires the lifecycle for each model', async () => {
    const ada = await User.create({ email: 'ada@example.com', name: 'Ada' });
    const events: string[] = [];

    User.observe({
      deleting: () => void events.push('deleting'),
      deleted: () => void events.push('deleted'),
    });

    await User.destroy(ada.getKey());

    expect(events).toEqual(['deleting', 'deleted']);
  });

  it('truncate empties the table', async () => {
    await User.create({ email: 'ada@example.com', name: 'Ada' });
    await User.create({ email: 'grace@example.com', name: 'Grace' });

    await User.truncate();

    expect(await count('users')).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Instance conveniences
  // -------------------------------------------------------------------------

  it('increment composes against the stored value, not a stale read', async () => {
    const user = await User.create({ email: 'ada@example.com', name: 'Ada', votes: 1 });

    // A second process moved the column between the read and the write.
    await adapter.query('UPDATE users SET votes = votes + 10 WHERE id = ?', [user.getKey()]);

    await user.increment('votes', 2);

    // The table holds the sum of both movements.
    expect(await column('users', 'votes', user.getKey())).toBe(13);
    expect(user.getAttribute('votes')).toBe(3);
  });

  it('increment writes extra columns and stamps the clock', async () => {
    const user = await User.create({ email: 'ada@example.com', name: 'Ada', votes: 1 });

    await user.increment('votes', 3, { name: 'Augusta' });

    expect(await column('users', 'name', user.getKey())).toBe('Augusta');
    expect(await column('users', 'votes', user.getKey())).toBe(4);
    // A column that really moved is a change to the row, so its clock moves too.
    expect(await column('users', 'updated_at', user.getKey())).not.toBeNull();
  });

  it('decrement moves the other way', async () => {
    const user = await User.create({ email: 'ada@example.com', name: 'Ada', votes: 5 });

    await user.decrement('votes', 2);

    expect(await column('users', 'votes', user.getKey())).toBe(3);
    expect(user.getAttribute('votes')).toBe(3);
  });

  it('increment leaves unsaved edits alone', async () => {
    const user = await User.create({ email: 'ada@example.com', name: 'Ada', votes: 1 });
    user.setAttribute('name', 'Pending');

    await user.increment('votes');

    expect(await column('users', 'votes', user.getKey())).toBe(2);
    // The name was never asked to be written, so the table still has the old one.
    expect(await column('users', 'name', user.getKey())).toBe('Ada');
    expect(user.isDirty('name')).toBe(true);

    await user.save();

    expect(await column('users', 'name', user.getKey())).toBe('Pending');
  });

  it('touch moves updated_at and nothing else', async () => {
    const user = new User({ email: 'ada@example.com', name: 'Ada' });
    user.setAttribute('created_at', new Date('2026-01-01T00:00:00.000Z'));
    user.setAttribute('updated_at', new Date('2026-01-01T00:00:00.000Z'));
    await user.save();

    const key = user.getKey();
    const stored = Date.parse('2026-01-01T00:00:00.000Z');

    user.setAttribute('name', 'Augusta');

    expect(await user.touch()).toBe(true);

    expect(new Date(await column('users', 'updated_at', key)).getTime()).toBeGreaterThan(stored);
    // The row's own content and its beginning were not part of the deal.
    expect(await column('users', 'name', key)).toBe('Ada');
    expect(new Date(await column('users', 'created_at', key)).getTime()).toBe(stored);
  });

  it('withoutTimestamps leaves the clock where it was', async () => {
    const user = new User({ email: 'ada@example.com', name: 'Ada' });
    user.setAttribute('created_at', new Date('2026-01-01T00:00:00.000Z'));
    user.setAttribute('updated_at', new Date('2026-01-01T00:00:00.000Z'));
    await user.save();

    const key = user.getKey();
    const stored = Date.parse('2026-01-01T00:00:00.000Z');

    await user.withoutTimestamps(async (model) => {
      expect(await model.touch()).toBe(false);
    });

    expect(new Date(await column('users', 'updated_at', key)).getTime()).toBe(stored);

    await user.touch();

    expect(new Date(await column('users', 'updated_at', key)).getTime()).toBeGreaterThan(stored);
  });

  it('replicate lands in the table as its own row', async () => {
    const user = await User.create({ email: 'ada@example.com', name: 'Ada', votes: 4 });

    const copy = user.replicate(['email']);

    expect(copy.exists).toBe(false);
    expect(copy.getAttribute('name')).toBe('Ada');
    expect(copy.getAttribute('votes')).toBe(4);
    expect(copy.getAttribute('email')).toBeUndefined();

    await copy.save();

    expect(copy.exists).toBe(true);
    expect(copy.getKey()).not.toBe(user.getKey());
    expect(await count('users')).toBe(2);
  });

  it('is compares rows, not objects', async () => {
    const user = await User.create({ email: 'ada@example.com', name: 'Ada' });

    const reread = await User.find(user.getKey());
    const other = await User.create({ email: 'grace@example.com', name: 'Grace' });

    expect(user.is(reread!)).toBe(true);
    expect(user.isNot(other)).toBe(true);
    expect(user.isNot(await Post.create({ user_id: user.getKey(), title: 'Hello' }))).toBe(true);
  });

  it('fresh reads the table without touching the model in hand', async () => {
    const user = await User.create({ email: 'ada@example.com', name: 'Ada' });

    await adapter.query('UPDATE users SET name = ? WHERE id = ?', ['Changed', user.getKey()]);
    user.setAttribute('name', 'Mine');

    const reloaded = await user.fresh();

    expect(reloaded?.getAttribute('name')).toBe('Changed');
    expect(user.getAttribute('name')).toBe('Mine');
    expect(await column('users', 'name', user.getKey())).toBe('Changed');
  });

  it('saveOrFail writes and rolls back on a cancelled event', async () => {
    const user = await new User({ email: 'ada@example.com', name: 'Ada' }).saveOrFail();

    expect(user).toBe(true);
    expect(await count('users')).toBe(1);

    User.observe({ saving: () => false });

    await expect(new User({ email: 'grace@example.com', name: 'Grace' }).saveOrFail()).rejects.toThrow(
      'cancelled by a model event'
    );
    // The rolled-back attempt left no trace.
    expect(await count('users')).toBe(1);
  });

  it('push saves the model and its loaded relations together', async () => {
    const user = await User.create({ email: 'ada@example.com', name: 'Ada' });
    const post = new Post({ user_id: user.getKey(), title: 'Hello' });
    user.setRelation('posts', [post]);

    user.setAttribute('name', 'Augusta');

    expect(await user.push()).toBe(true);
    expect(await column('users', 'name', user.getKey())).toBe('Augusta');
    expect(post.exists).toBe(true);
    expect(await count('posts')).toBe(1);

    const attached = await user.posts().getResults();

    expect(attached.map((related) => related.getAttribute('title'))).toEqual(['Hello']);
  });
});
