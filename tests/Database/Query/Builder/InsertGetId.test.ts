/**
 * insertGetId() and returning() per dialect
 *
 * SQLite reads `lastInsertRowid`, MySQL reads `insertId` and PostgreSQL asks for
 * the key with `RETURNING`. Which one applies is a grammar decision, so these
 * tests pin each dialect to the mechanism the ticket requires.
 */

import { describe, it, expect } from 'vitest';
import { MySqlGrammar, PostgresGrammar, SqliteGrammar } from '@/Database/Query/Grammars';
import { queryOn } from '../support';

describe('Query Builder insertGetId()', () => {
  it('uses the driver last insert rowid on SQLite', async () => {
    const { builder, queries } = queryOn(new SqliteGrammar(), 'users', { insert: 42n });

    const id = await builder.insertGetId({ name: 'Ada' });

    expect(id).toBe(42n);
    expect(queries).toHaveLength(1);
    expect(queries[0].method).toBe('insert');
    expect(queries[0].sql).toBe('INSERT INTO "users" ("name") VALUES (?)');
    expect(queries[0].bindings).toEqual(['Ada']);
  });

  it('uses the driver insert id on MySQL', async () => {
    const { builder, queries } = queryOn(new MySqlGrammar(), 'users', { insert: 7 });

    expect(await builder.insertGetId({ name: 'Ada' })).toBe(7);
    expect(queries[0].sql).toBe('INSERT INTO `users` (`name`) VALUES (?)');
  });

  it('uses RETURNING on PostgreSQL and reads the key off the returned row', async () => {
    const { builder, queries } = queryOn(new PostgresGrammar(), 'users', { select: [{ id: 9 }] });

    expect(await builder.insertGetId({ name: 'Ada' })).toBe(9);
    expect(queries[0].method).toBe('select');
    expect(queries[0].sql).toBe('INSERT INTO "users" ("name") VALUES (?) RETURNING "id"');
    expect(queries[0].bindings).toEqual(['Ada']);
  });

  it('reads back the key column the caller names instead of assuming one', async () => {
    const { builder, queries } = queryOn(new PostgresGrammar(), 'users', { select: [{ uuid: 'a1b2' }] });

    expect(await builder.insertGetId({ uuid: 'a1b2', name: 'Ada' }, 'uuid')).toBe('a1b2');
    expect(queries[0].sql).toBe('INSERT INTO "users" ("uuid", "name") VALUES (?, ?) RETURNING "uuid"');
    expect(queries[0].bindings).toEqual(['a1b2', 'Ada']);
  });

  it('honours a configured returning column as the key', async () => {
    const { builder, queries } = queryOn(new PostgresGrammar(), 'users', { select: [{ token: 't-1' }] });

    expect(await builder.returning('token').insertGetId({ name: 'Ada' })).toBe('t-1');
    expect(queries[0].sql).toBe('INSERT INTO "users" ("name") VALUES (?) RETURNING "token"');
  });

  it('inserts a record with several columns in column order', async () => {
    const { builder, queries } = queryOn(new SqliteGrammar(), 'users', { insert: 1 });

    await builder.insertGetId({ name: 'Ada', created_at: new Date('2026-01-01T00:00:00.000Z'), active: true });

    expect(queries[0].sql).toBe('INSERT INTO "users" ("name", "created_at", "active") VALUES (?, ?, ?)');
    expect(queries[0].bindings).toEqual(['Ada', new Date('2026-01-01T00:00:00.000Z'), true]);
  });

  it('rejects a bulk insert instead of guessing which id to return', async () => {
    const { builder } = queryOn(new SqliteGrammar(), 'users', { insert: 1 });

    await expect(builder.insertGetId([{ name: 'Ada' }] as any)).rejects.toThrow(/more than one record/);
  });

  it('rejects an empty record', async () => {
    const { builder } = queryOn(new SqliteGrammar(), 'users');

    await expect(builder.insertGetId({})).rejects.toThrow(/without any columns/);
  });
});
