/**
 * Query builder compilation tests
 *
 * The builder keeps the state and the fluent API; compiling it is the grammar's
 * job. These tests pin the statement shape the builder used to produce, so the
 * extraction is provably behaviour-preserving, plus the debugging helper.
 */

import { describe, it, expect } from 'vitest';
import { Builder } from '@/Database/Query/Builder';
import { MySqlGrammar, PostgresGrammar, SqliteGrammar } from '@/Database/Query/Grammars';
import { queryOn, recordAdapter } from '../support';

describe('Query Builder compilation', () => {
  it('compiles a full select through the grammar', () => {
    const { builder } = queryOn(new SqliteGrammar());

    builder.select('id', 'name').where('votes', '>', 100).orderBy('created_at', 'desc').limit(10).offset(5);

    expect(builder.getGrammar()).toBeInstanceOf(SqliteGrammar);
    expect(builder.toSql()).toBe(
      'SELECT "id", "name" FROM "users" WHERE "votes" > ? ORDER BY "created_at" DESC LIMIT 10 OFFSET 5'
    );
    expect(builder.getBindings()).toEqual([100]);
  });

  it('quotes identifiers for the dialect it was built with', () => {
    const sqlFor = (grammar: any) => {
      const { builder } = queryOn(grammar, 'users');
      return builder.select('users.name').where('users.id', '=', 1).toSql();
    };

    expect(sqlFor(new SqliteGrammar())).toBe('SELECT "users"."name" FROM "users" WHERE "users"."id" = ?');
    expect(sqlFor(new PostgresGrammar())).toBe('SELECT "users"."name" FROM "users" WHERE "users"."id" = ?');
    expect(sqlFor(new MySqlGrammar())).toBe('SELECT `users`.`name` FROM `users` WHERE `users`.`id` = ?');
  });

  it('compiles joins with quoted tables and columns', () => {
    const { builder } = queryOn(new MySqlGrammar());

    builder.join('posts', 'users.id', '=', 'posts.user_id').leftJoin('comments', 'posts.id', '=', 'comments.post_id');

    expect(builder.toSql()).toBe(
      'SELECT * FROM `users` ' +
        'INNER JOIN `posts` ON `users`.`id` = `posts`.`user_id` ' +
        'LEFT JOIN `comments` ON `posts`.`id` = `comments`.`post_id`'
    );
  });

  it('compiles group by and having together', () => {
    const { builder } = queryOn(new SqliteGrammar());

    builder.select('role').groupBy('role').having('votes', '>', 100);

    expect(builder.toSql()).toBe('SELECT "role" FROM "users" GROUP BY "role" HAVING "votes" > ?');
    expect(builder.getBindings()).toEqual([100]);
  });

  it('compiles distinct, star and aggregate selects', () => {
    const { builder } = queryOn(new SqliteGrammar());

    expect(builder.distinct().toSql()).toBe('SELECT DISTINCT * FROM "users"');
    expect(builder.getGrammar().compileAggregate('SUM', 'balance')).toBe('SUM("balance") as aggregate');
    expect(builder.getGrammar().compileAggregate('COUNT', '*')).toBe('COUNT(*) as aggregate');
  });

  it('splits a comma separated select list into quoted columns', () => {
    const { builder } = queryOn(new SqliteGrammar());

    expect(builder.select('id, users.name').toSql()).toBe('SELECT "id", "users"."name" FROM "users"');
  });

  it('rejects an unsafe identifier instead of interpolating it', () => {
    const { builder } = queryOn(new SqliteGrammar());

    expect(() => builder.select('id FROM users --').toSql()).toThrow(/Unsupported identifier/);
    expect(() => builder.where('a = 1 OR 1', '=', 1).toSql()).toThrow(/Unsupported identifier/);
    expect(() => builder.orderBy('id DESC, (SELECT 1)').toSql()).toThrow(/Unsupported identifier/);
  });

  it('rejects an unsafe operator instead of interpolating it', () => {
    const { builder } = queryOn(new SqliteGrammar());

    expect(() => builder.where('id', '= 1 OR 1', 1).toSql()).toThrow(/Unsupported operator/);
    expect(() => builder.having('votes', '; DROP TABLE users', 1).toSql()).toThrow(/Unsupported operator/);
    expect(() => builder.join('posts', 'users.id', '= 1 OR 1', 'posts.user_id').toSql()).toThrow(
      /Unsupported operator/
    );
  });

  it('interpolates bindings into the debugging statement only', async () => {
    const { builder, queries } = queryOn(new SqliteGrammar());

    builder
      .select('name')
      .where('name', '=', "Robert'); DROP TABLE users;--")
      .where('active', '=', true)
      .whereNotNull('bio')
      .whereRaw('score > ?', [10]);

    expect(builder.toRawSql()).toBe(
      `SELECT "name" FROM "users" WHERE "name" = 'Robert''); DROP TABLE users;--' ` +
        'AND "active" = 1 AND "bio" IS NOT NULL AND score > 10'
    );

    await builder.get();

    // toRawSql is display only: what reaches the driver stays parameterized.
    expect(queries[0].sql).toBe(
      'SELECT "name" FROM "users" WHERE "name" = ? AND "active" = ? AND "bio" IS NOT NULL AND score > ?'
    );
    expect(queries[0].bindings).toEqual(["Robert'); DROP TABLE users;--", true, 10]);
  });

  it('shows NULL and ISO dates in the debugging statement', () => {
    const { builder } = queryOn(new PostgresGrammar());

    builder.where('deleted_at', '=', null).where('created_at', '>', new Date('2026-01-01T00:00:00.000Z'));

    expect(builder.toRawSql()).toBe(
      'SELECT * FROM "users" WHERE "deleted_at" = NULL AND "created_at" > \'2026-01-01T00:00:00.000Z\''
    );
  });

  it('clones without sharing state or bindings', () => {
    const { builder } = queryOn(new SqliteGrammar());

    builder.selectRaw('? as x', [1]).where('a', 2);
    const cloned = builder.clone().where('b', 3);

    expect(cloned.getBindings()).toEqual([1, 2, 3]);
    expect(builder.getBindings()).toEqual([1, 2]);
    expect(cloned.getGrammar()).toBe(builder.getGrammar());
    expect(cloned.toSql()).toBe('SELECT *, ? as x FROM "users" WHERE "a" = ? AND "b" = ?');
  });

  it('truncates through the grammar', async () => {
    const { builder, queries } = queryOn(new SqliteGrammar(), 'logs');

    await builder.truncate();
    expect(queries[0]).toEqual({ method: 'query', sql: 'DELETE FROM "logs"', bindings: [] });
  });

  it('refuses to compile without a table', () => {
    const { adapter } = recordAdapter();
    const builder = new Builder(adapter, new SqliteGrammar());

    expect(() => builder.toSql()).toThrow('Cannot generate SQL without specifying a table');
  });

  it('keeps every statement placeholder a question mark for the adapter to rewrite', () => {
    const { builder } = queryOn(new PostgresGrammar());

    builder.select('id').where('a', 1).whereIn('b', [2, 3]);

    expect(builder.toSql()).toBe('SELECT "id" FROM "users" WHERE "a" = ? AND "b" IN (?, ?)');
    expect(builder.getBindings()).toEqual([1, 2, 3]);
  });
});
