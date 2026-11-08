/**
 * Query builder binding tests
 *
 * Bindings are collected per clause and flattened in the order the clauses
 * appear in the compiled statement, so mixing raw select expressions with where
 * and having clauses can never shuffle a value into the wrong placeholder.
 */

import { describe, it, expect } from 'vitest';
import { SqliteGrammar } from '@/Database/Query/Grammars';
import { queryOn } from '../support';

describe('Query Builder binding order', () => {
  it('binds a raw select value ahead of a where value', () => {
    const { builder } = queryOn(new SqliteGrammar());

    expect(builder.selectRaw('? as x', [1]).where('a', 2).getBindings()).toEqual([1, 2]);
  });

  it('keeps select bindings first even when the raw select is declared last', async () => {
    const { builder, queries } = queryOn(new SqliteGrammar());

    builder.where('a', 2).selectRaw('? as x', [1]);

    expect(builder.toSql()).toBe('SELECT *, ? as x FROM "users" WHERE "a" = ?');
    expect(builder.getBindings()).toEqual([1, 2]);

    await builder.get();

    expect(queries[0]).toEqual({
      method: 'select',
      sql: 'SELECT *, ? as x FROM "users" WHERE "a" = ?',
      bindings: [1, 2],
    });
  });

  it('groups bindings by clause', () => {
    const { builder } = queryOn(new SqliteGrammar());

    builder
      .selectRaw('? as x', [1])
      .where('a', 2)
      .whereRaw('lower(email) = ?', ['ada'])
      .groupBy('role')
      .having('votes', '>', 3)
      .orderBy('created_at');

    expect(builder.getRawBindings()).toEqual({
      select: [1],
      join: [],
      where: [2, 'ada'],
      having: [3],
      order: [],
    });

    expect(builder.getBindings()).toEqual([1, 2, 'ada', 3]);
  });

  it('orders select, join, where, having and order bindings like the statement', () => {
    const { builder } = queryOn(new SqliteGrammar());

    builder.having('votes', '>', 4).orderBy('votes');
    builder.where('a', 1);
    builder.selectRaw('? as x', [2]);
    builder.where('b', 3);

    expect(builder.toSql()).toBe(
      'SELECT *, ? as x FROM "users" WHERE "a" = ? AND "b" = ? HAVING "votes" > ? ORDER BY "votes" ASC'
    );
    expect(builder.getBindings()).toEqual([2, 1, 3, 4]);
  });

  it('binds every where value, including null, so placeholders stay aligned', async () => {
    const { builder, queries } = queryOn(new SqliteGrammar());

    builder.where('a', 1).where('b', '=', null).where('c', 3);

    await builder.get();

    expect(builder.toSql()).toBe('SELECT * FROM "users" WHERE "a" = ? AND "b" = ? AND "c" = ?');
    expect(queries[0].bindings).toEqual([1, null, 3]);
  });

  it('spreads the values of list operators into the where bindings', () => {
    const { builder } = queryOn(new SqliteGrammar());

    builder.where('a', 1).whereIn('b', [2, 3]).whereBetween('c', [4, 5]).whereNotIn('d', [6]);

    expect(builder.toSql()).toBe(
      'SELECT * FROM "users" WHERE "a" = ? AND "b" IN (?, ?) AND "c" BETWEEN ? AND ? AND "d" NOT IN (?)'
    );
    expect(builder.getBindings()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('binds null-checking operators without a value', () => {
    const { builder } = queryOn(new SqliteGrammar());

    builder.whereNull('deleted_at').whereNotNull('a').where('b', 2);

    expect(builder.toSql()).toBe('SELECT * FROM "users" WHERE "deleted_at" IS NULL AND "a" IS NOT NULL AND "b" = ?');
    expect(builder.getBindings()).toEqual([2]);
  });

  it('binds a raw where clause into the where group', () => {
    const { builder } = queryOn(new SqliteGrammar());

    builder.selectRaw('? as x', [0]).whereRaw('lower(name) = ?', ['ada']).where('age', '>', 3);

    expect(builder.toSql()).toBe('SELECT *, ? as x FROM "users" WHERE lower(name) = ? AND "age" > ?');
    expect(builder.getBindings()).toEqual([0, 'ada', 3]);
  });

  it('binds update values before the where values', async () => {
    const { builder, queries } = queryOn(new SqliteGrammar());

    builder.where('a', 1).where('b', 2).selectRaw('? as x', [9]);
    await builder.update({ name: 'Ada', votes: 3 });

    expect(queries[0].method).toBe('update');
    expect(queries[0].sql).toBe('UPDATE "users" SET "name" = ?, "votes" = ? WHERE "a" = ? AND "b" = ?');
    expect(queries[0].bindings).toEqual(['Ada', 3, 1, 2]);
  });

  it('deletes with the where bindings only', async () => {
    const { builder, queries } = queryOn(new SqliteGrammar());

    builder.selectRaw('? as x', [9]).where('a', 1).having('b', '>', 2);
    await builder.delete();

    expect(queries[0].method).toBe('delete');
    expect(queries[0].sql).toBe('DELETE FROM "users" WHERE "a" = ?');
    expect(queries[0].bindings).toEqual([1]);
  });

  it('restores the select bindings after an aggregate runs', async () => {
    const { builder, queries } = queryOn(new SqliteGrammar(), 'users', { select: [{ aggregate: 2 }] });

    builder.selectRaw('? as x', [1]).where('a', 2);

    expect(await builder.count()).toBe(2);
    expect(queries[0].sql).toBe('SELECT *, ? as x, COUNT(*) as aggregate FROM "users" WHERE "a" = ? LIMIT 1');
    expect(queries[0].bindings).toEqual([1, 2]);

    // The aggregate select expression is transient: the query it ran on is intact.
    expect(builder.toSql()).toBe('SELECT *, ? as x FROM "users" WHERE "a" = ? LIMIT 1');
    expect(builder.getBindings()).toEqual([1, 2]);
  });
});
