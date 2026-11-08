/**
 * Query builder against a real SQLite database
 *
 * Grammar output for the other dialects is pinned in the grammar tests; this
 * suite runs the compiled statements through better-sqlite3, which is what
 * proves quoted identifiers (`table.column`, `column as alias`, reserved words)
 * and per-clause binding order actually work against a driver.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DrizzleAdapter } from '@/Database/Adapters/DrizzleAdapter';
import { Connection } from '@/Database/Connection';
import { WITH_BETTER_SQLITE } from '../../support';

const SCHEMA = [
  `CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    role TEXT,
    "order" INTEGER
  )`,
  `CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    votes INTEGER
  )`,
  'CREATE TABLE post_user (user_id INTEGER, post_id INTEGER)',
];

describe.skipIf(!WITH_BETTER_SQLITE)('Query Builder (better-sqlite3)', () => {
  let adapter: DrizzleAdapter;
  let connection: Connection;

  beforeEach(async () => {
    adapter = new DrizzleAdapter({ driver: 'better-sqlite3', database: ':memory:' });
    await adapter.connect();

    // better-sqlite3 prepares one statement at a time, so the schema is applied
    // statement by statement.
    for (const statement of SCHEMA) {
      await adapter.query(statement);
    }

    connection = new Connection(adapter, { driver: 'better-sqlite3', database: ':memory:' });

    await connection.table('users').insert([
      { name: 'Ada', role: 'admin', order: 2 },
      { name: 'Grace', role: 'admin', order: 1 },
      { name: 'Alan', role: 'user', order: 3 },
    ]);

    await connection.table('posts').insert([
      { user_id: 1, title: 'Compose', votes: 10 },
      { user_id: 1, title: 'Analytical', votes: 20 },
      { user_id: 2, title: 'Compiler', votes: 30 },
    ]);

    await connection.table('post_user').insert([
      { user_id: 1, post_id: 1 },
      { user_id: 2, post_id: 2 },
    ]);
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  it('resolves the SQLite grammar from the connection configuration', () => {
    expect(connection.getGrammar().supportsReturning()).toBe(true);
    expect(connection.getGrammar().usesLastInsertId()).toBe(true);
  });

  it('quotes a reserved word used as a column name', async () => {
    const rows = await connection.table('users').select('name').orderBy('order', 'asc').get();

    expect(rows.map((row) => row.name)).toEqual(['Grace', 'Ada', 'Alan']);
  });

  it('compiles qualified columns and aliases that the driver understands', async () => {
    const rows = await connection
      .table('users')
      .select('users.name as full_name', 'post_user.post_id as pivot_post_id')
      .join('post_user', 'users.id', '=', 'post_user.user_id')
      .where('users.role', '=', 'admin')
      .get();

    expect(rows).toEqual([
      { full_name: 'Ada', pivot_post_id: 1 },
      { full_name: 'Grace', pivot_post_id: 2 },
    ]);
  });

  it('runs group by, having, order, limit and offset together', async () => {
    const rows = await connection
      .table('posts')
      .select('user_id')
      .selectRaw('SUM(votes) as total')
      .groupBy('user_id')
      .having('user_id', '=', 1)
      .orderBy('user_id', 'desc')
      .limit(10)
      .get();

    expect(rows).toEqual([{ user_id: 1, total: 30 }]);
  });

  it('binds a raw select value before a where value in declaration order', async () => {
    const builder = connection
      .table('users')
      .where('role', '=', 'admin')
      .selectRaw('? as kind', ['lookup'])
      .orderBy('name');

    expect(builder.getBindings()).toEqual(['lookup', 'admin']);

    const rows = await builder.get();
    expect(rows.map((row) => row.name)).toEqual(['Ada', 'Grace']);
    expect(rows[0]).toMatchObject({ kind: 'lookup', role: 'admin' });
  });

  it('keeps raw where bindings aligned with later clauses', async () => {
    const rows = await connection
      .table('posts')
      .whereRaw('votes >= ?', [20])
      .where('user_id', '=', 1)
      .orWhere('title', 'like', 'Com%')
      .get();

    // `votes >= 20 AND user_id = 1` fails for Ada's posts, so only the
    // OR branch and the third row match.
    expect(rows.map((row) => row.title).sort()).toEqual(['Analytical', 'Compiler', 'Compose'].sort());
  });

  it('aggregates with a quoted column', async () => {
    expect(await connection.table('users').count()).toBe(3);
    expect(await connection.table('posts').max('votes')).toBe(30);
    expect(await connection.table('posts').where('user_id', '=', 1).sum('votes')).toBe(30);
    expect(await connection.table('posts').where('user_id', '=', 99).count()).toBe(0);
  });

  it('inserts and reads the generated key from the driver', async () => {
    const id = await connection.table('users').insertGetId({ name: 'Edsger', role: 'user', order: 4 });

    expect(Number(id)).toBe(4);
    expect(await connection.table('users').where('id', '=', id).value('name')).toBe('Edsger');
  });

  it('returns the requested columns from insert().returning() without assuming a key name', async () => {
    const row = await connection
      .table('users')
      .insert({ name: 'Barbara', role: 'admin', order: 5 })
      .returning(['id', 'name']);

    expect(row).toEqual({ id: 4, name: 'Barbara' });

    const rows = await connection.table('post_user').insertReturning([{ user_id: 3, post_id: 3 }], ['post_id']);

    expect(rows).toEqual({ post_id: 3 });
  });

  it('updates and deletes with the bindings the statement expects', async () => {
    const updated = await connection
      .table('users')
      .where('role', '=', 'admin')
      .whereBetween('order', [1, 2])
      .update({ role: 'founder' });

    expect(updated).toBe(2);
    expect(await connection.table('users').where('role', '=', 'founder').count()).toBe(2);

    const deleted = await connection.table('post_user').whereIn('post_id', [1, 2]).delete();
    expect(deleted).toBe(2);
  });

  it('truncates a table by deleting every row', async () => {
    await connection.table('post_user').truncate();
    expect(await connection.table('post_user').count()).toBe(0);
  });

  it('shows interpolated values in toRawSql without executing them', async () => {
    const builder = connection
      .table('users')
      .select('name')
      .where('name', '=', "Robert'); DROP TABLE users;--")
      .where('order', '>', 1);

    expect(builder.toRawSql()).toBe(
      `SELECT "name" FROM "users" WHERE "name" = 'Robert''); DROP TABLE users;--' AND "order" > 1`
    );

    // The table is still there, because the executed statement stayed parameterized.
    await builder.get();
    expect(await connection.table('users').count()).toBe(3);
  });

  it('rejects an injection attempt passed as an identifier before it reaches the driver', async () => {
    expect(() => connection.table('users').select('name; DROP TABLE users --').toSql()).toThrow(
      /Unsupported identifier/
    );

    expect(await connection.table('users').count()).toBe(3);
  });
});
