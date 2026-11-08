/**
 * Schema builder against a real SQLite database
 *
 * The grammar tests pin the compiled text for every dialect; this suite runs
 * the compiled statements through better-sqlite3, which is what proves the
 * primary keys, inline foreign keys, quoted defaults and `PRAGMA table_info`
 * column listing actually work on a driver.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DrizzleAdapter } from '@/Database/Adapters/DrizzleAdapter';
import { Connection } from '@/Database/Connection';
import { SchemaBuilder } from '@/Database/Migrations/SchemaBuilder';
import { raw } from '@/Database/Query/Expression';
import { WITH_BETTER_SQLITE } from '../support';

describe.skipIf(!WITH_BETTER_SQLITE)('SchemaBuilder (better-sqlite3)', () => {
  let adapter: DrizzleAdapter;
  let connection: Connection;
  let schema: SchemaBuilder;

  beforeEach(async () => {
    adapter = new DrizzleAdapter({ driver: 'better-sqlite3', database: ':memory:' });
    await adapter.connect();

    connection = new Connection(adapter, { driver: 'better-sqlite3', database: ':memory:' });
    schema = new SchemaBuilder(connection);
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  const columnInfo = (table: string) => connection.select(`PRAGMA table_info("${table}")`);

  it('creates an id() column that is the primary key', async () => {
    await schema.create('users', (table) => {
      table.id();
      table.string('name');
    });

    // An insert without a key gets one assigned, which only happens for a real
    // rowid alias primary key.
    await connection.table('users').insert({ name: 'Ada' });
    await connection.table('users').insert({ name: 'Grace' });

    const rows = await connection.table('users').orderBy('id', 'asc').get();
    expect(rows.map((row) => row.id)).toEqual([1, 2]);

    const [{ pk }] = (await columnInfo('users')).filter((column) => column.name === 'id');
    expect(pk).toBe(1);
  });

  it('creates increments() and bigIncrements() as primary keys too', async () => {
    await schema.create('posts', (table) => {
      table.increments('post_id');
    });

    await schema.create('logs', (table) => {
      table.bigIncrements('log_id');
    });

    await connection.table('posts').insert({ post_id: null });
    await connection.table('logs').insert({ log_id: null });

    expect(await connection.table('posts').max('post_id')).toBe(1);
    expect(await connection.table('logs').max('log_id')).toBe(1);
  });

  it('makes a non-incrementing primary key work', async () => {
    await schema.create('cache', (table) => {
      table.string('key', 255).primary();
      table.text('value');
    });

    await connection.table('cache').insert({ key: 'a', value: 'first' });

    // The key is unique, because it is the primary key.
    await expect(connection.table('cache').insert({ key: 'a', value: 'second' })).rejects.toThrow(/UNIQUE/);
  });

  it('answers hasColumn about the requested column, not any column', async () => {
    await schema.create('users', (table) => {
      table.id();
      table.string('email');
    });

    await expect(schema.hasTable('users')).resolves.toBe(true);
    await expect(schema.hasTable('missing')).resolves.toBe(false);
    await expect(schema.hasColumn('users', 'email')).resolves.toBe(true);
    await expect(schema.hasColumn('users', 'missing')).resolves.toBe(false);
    await expect(schema.hasColumn('users', 'id')).resolves.toBe(true);
  });

  it('stores a string default containing a quote and hands it back', async () => {
    await schema.create('products', (table) => {
      table.id();
      table.string('nickname').default("O'Brien");
      table.string('plain').default('ready');
    });

    await connection.table('products').insert({ id: null });

    const [row] = await connection.table('products').get();
    expect(row.nickname).toBe("O'Brien");
    expect(row.plain).toBe('ready');
  });

  it('accepts a wrapped expression as raw default SQL', async () => {
    await schema.create('events', (table) => {
      table.id();
      table.string('kind').default(raw("'click'"));
    });

    await connection.table('events').insert({ id: null });

    const [row] = await connection.table('events').get();
    expect(row.kind).toBe('click');
  });

  it('refuses a default that cannot be a literal', async () => {
    await expect(
      schema.create('events', (table) => {
        table.json('payload').default({ not: 'a literal' });
      })
    ).rejects.toThrow(/column default value/);

    await expect(schema.hasTable('events')).resolves.toBe(false);
  });

  it('creates a constrained foreign key inline and enforces it', async () => {
    await schema.create('users', (table) => {
      table.id();
    });

    await schema.create('posts', (table) => {
      table.id();
      table.foreignId('user_id').constrained().cascadeOnDelete();
    });

    const [{ sql }] = await connection.select('SELECT "sql" FROM "sqlite_master" WHERE "type" = ? AND "name" = ?', [
      'table',
      'posts',
    ]);
    expect(sql).toContain('FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE');

    await connection.query('PRAGMA foreign_keys = ON');
    await connection.table('users').insert({ id: 1 });
    await connection.table('posts').insert({ user_id: 1 });

    await expect(connection.table('posts').insert({ user_id: 99 })).rejects.toThrow(/FOREIGN KEY/);

    // Deleting the user takes their post with it.
    await connection.table('users').where('id', '=', 1).delete();
    expect(await connection.table('posts').count()).toBe(0);
  });

  it('declares the columns of a polymorphic relation', async () => {
    await schema.create('comments', (table) => {
      table.id();
      table.morphs('commentable');
      table.nullableMorphs('authorable');
    });

    const columns = await columnInfo('comments');
    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'commentable_type',
      'commentable_id',
      'authorable_type',
      'authorable_id',
    ]);

    const notNull = Object.fromEntries(columns.map((column) => [column.name, column.notnull]));
    expect(notNull.commentable_type).toBe(1);
    expect(notNull.commentable_id).toBe(1);
    expect(notNull.authorable_type).toBe(0);
    expect(notNull.authorable_id).toBe(0);

    await connection.table('comments').insert({ commentable_type: 'posts', commentable_id: 1 });
    expect(await connection.table('comments').count()).toBe(1);
  });

  it('stores a ulid column as fixed width text', async () => {
    await schema.create('orders', (table) => {
      table.ulid('ulid').primary();
      table.string('reference');
    });

    await connection.table('orders').insert({ ulid: '01ARZ3NDEKTSV4RRFFQ69G5FAV', reference: 'x' });

    await expect(
      connection.table('orders').insert({ ulid: '01ARZ3NDEKTSV4RRFFQ69G5FAV', reference: 'y' })
    ).rejects.toThrow(/UNIQUE/);
  });

  it('adds, renames and drops columns through table()', async () => {
    await schema.create('users', (table) => {
      table.id();
      table.string('name');
      table.string('tmp');
      table.timestamps();
      table.softDeletes();
    });

    await schema.table('users', (table) => {
      table.integer('votes').default(0);
      table.renameColumn('name', 'full_name');
      table.dropColumn('tmp');
    });

    const columns = await columnInfo('users');
    expect(columns.map((column) => column.name)).toEqual([
      'id',
      'full_name',
      'created_at',
      'updated_at',
      'deleted_at',
      'votes',
    ]);

    await connection.table('users').insert({ full_name: 'Ada' });
    expect((await connection.table('users').get())[0].votes).toBe(0);

    await schema.table('users', (table) => {
      table.dropTimestamps();
      table.dropSoftDeletes();
    });

    expect((await columnInfo('users')).map((column) => column.name)).toEqual(['id', 'full_name', 'votes']);
    await expect(schema.hasColumn('users', 'created_at')).resolves.toBe(false);
    await expect(schema.hasColumn('users', 'deleted_at')).resolves.toBe(false);
  });

  it('creates and drops indexes by name and by columns', async () => {
    await schema.create('users', (table) => {
      table.id();
      table.string('email');
      table.string('name');
      table.index('name');
      table.unique('email');
    });

    const indexNames = async () =>
      (await connection.select('PRAGMA index_list("users")')).map((row) => row.name).sort();

    expect(await indexNames()).toEqual(['users_email_unique', 'users_name_index']);

    await schema.table('users', (table) => {
      table.dropIndex('users_name_index');
      table.dropUnique(['email']);
    });

    expect(await indexNames()).toEqual([]);
  });

  it('renames a table and drops it when asked', async () => {
    await schema.create('users', (table) => {
      table.id();
    });

    await schema.rename('users', 'accounts');
    await expect(schema.hasTable('users')).resolves.toBe(false);
    await expect(schema.hasTable('accounts')).resolves.toBe(true);

    await schema.drop('accounts');
    await expect(schema.hasTable('accounts')).resolves.toBe(false);

    // dropIfExists tolerates a table that is already gone.
    await expect(schema.dropIfExists('accounts')).resolves.toBeUndefined();
  });

  it('says so when SQLite cannot express a command', async () => {
    await schema.create('users', (table) => {
      table.id();
    });

    await schema.create('posts', (table) => {
      table.id();
      table.foreignId('user_id').constrained();
    });

    await expect(schema.table('posts', (table) => table.dropForeign('posts_user_id_foreign'))).rejects.toThrow(
      /does not support dropping foreign key constraints/
    );

    await expect(schema.table('posts', (table) => table.dropPrimary())).rejects.toThrow(
      /does not support dropping primary keys/
    );

    await expect(schema.table('posts', (table) => table.string('title').change())).rejects.toThrow(
      /does not support modifying table columns/
    );
  });

  it('drops every table with foreign key constraints switched off', async () => {
    await schema.create('users', (table) => {
      table.id();
    });

    await schema.create('posts', (table) => {
      table.id();
      table.foreignId('user_id').constrained();
    });

    const statements: string[] = [];
    const spy = vi.spyOn(connection, 'query').mockImplementation(async (sql: string) => {
      statements.push(sql);

      return adapter.query(sql);
    });

    await schema.withoutForeignKeyConstraints(async () => {
      for (const table of ['posts', 'users']) {
        await schema.dropIfExists(table);
      }
    });

    expect(statements).toEqual([
      'PRAGMA foreign_keys = OFF',
      'DROP TABLE IF EXISTS "posts"',
      'DROP TABLE IF EXISTS "users"',
      'PRAGMA foreign_keys = ON',
    ]);

    spy.mockRestore();

    await expect(schema.hasTable('users')).resolves.toBe(false);
  });

  it('restores constraints when the callback fails', async () => {
    const statements: string[] = [];
    const spy = vi.spyOn(connection, 'query').mockImplementation(async (sql: string) => {
      statements.push(sql);

      return adapter.query(sql);
    });

    await expect(
      schema.withoutForeignKeyConstraints(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(statements).toEqual(['PRAGMA foreign_keys = OFF', 'PRAGMA foreign_keys = ON']);

    spy.mockRestore();
  });
});
