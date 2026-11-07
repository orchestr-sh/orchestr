import { describe, it, expect } from 'vitest';
import { raw } from '@/Database/Query/Expression';
import { SqliteGrammar } from '@/Database/Query/Grammars';
import { queryState } from '../support';

const grammar = new SqliteGrammar();

describe('SqliteGrammar identifiers', () => {
  it('quotes bare column and table names with double quotes', () => {
    expect(grammar.wrap('email')).toBe('"email"');
    expect(grammar.wrapTable('users')).toBe('"users"');
  });

  it('quotes every segment of a qualified column', () => {
    expect(grammar.wrap('users.email')).toBe('"users"."email"');
    expect(grammar.wrap('project_user.user_id as pivot_user_id')).toBe('"project_user"."user_id" as "pivot_user_id"');
  });

  it('leaves the star unquoted, qualified or not', () => {
    expect(grammar.wrap('*')).toBe('*');
    expect(grammar.wrap('users.*')).toBe('"users".*');
  });

  it('passes raw expressions through untouched', () => {
    expect(grammar.wrap(raw('count(*) as total'))).toBe('count(*) as total');
  });

  it('rejects identifiers that cannot be a quoted name', () => {
    expect(() => grammar.wrap('email; DROP TABLE users')).toThrow(/Unsupported identifier/);
    expect(() => grammar.wrap('a" = 1 OR 1=1 --')).toThrow(/Unsupported identifier/);
    expect(() => grammar.wrap('(select 1) as one')).toThrow(/Unsupported identifier/);
  });

  it('compiles a select in clause order', () => {
    const sql = grammar.compileSelect(
      queryState({
        distinct: true,
        columns: ['users.id', 'users.email as contact'],
        joins: [{ type: 'inner', table: 'posts', first: 'users.id', operator: '=', second: 'posts.user_id' }],
        wheres: [{ column: 'users.id', operator: '=', value: 1, boolean: 'and' }],
        groups: ['users.role'],
        havings: [{ column: 'role', operator: '=', value: 'admin' }],
        orders: [{ column: 'users.created_at', direction: 'desc' }],
        limit: 10,
        offset: 20,
      })
    );

    expect(sql).toBe(
      'SELECT DISTINCT "users"."id", "users"."email" as "contact" FROM "users" ' +
        'INNER JOIN "posts" ON "users"."id" = "posts"."user_id" ' +
        'WHERE "users"."id" = ? ' +
        'GROUP BY "users"."role" ' +
        'HAVING "role" = ? ' +
        'ORDER BY "users"."created_at" DESC ' +
        'LIMIT 10 OFFSET 20'
    );
  });

  it('compiles where variants with quoted identifiers', () => {
    const sql = grammar.compileWheres(
      queryState({
        wheres: [
          { column: 'a', operator: '=', value: 1, boolean: 'and' },
          { column: 'b', operator: 'in', value: [1, 2], boolean: 'or' },
          { column: 'c', operator: 'not in', value: [3], boolean: 'and' },
          { column: 'd', operator: 'between', value: [1, 2], boolean: 'and' },
          { column: 'e', operator: 'is null', value: null, boolean: 'and' },
          { column: 'f', operator: 'is not null', value: null, boolean: 'and' },
          { column: raw('g + ? > 0'), operator: 'raw', value: null, boolean: 'and' },
        ],
      })
    );

    expect(sql).toBe(
      '"a" = ? OR "b" IN (?, ?) AND "c" NOT IN (?) AND "d" BETWEEN ? AND ? AND "e" IS NULL ' +
        'AND "f" IS NOT NULL AND g + ? > 0'
    );
  });

  it('compiles an insert quoting the table and every column', () => {
    const sql = grammar.compileInsert(queryState(), [{ name: 'a' }, { name: 'b' }]);

    expect(sql).toBe('INSERT INTO "users" ("name") VALUES (?), (?)');
  });

  it('appends RETURNING for the requested columns', () => {
    const sql = grammar.compileInsertReturning(queryState(), [{ name: 'a' }], ['id', 'created_at']);

    expect(sql).toBe('INSERT INTO "users" ("name") VALUES (?) RETURNING "id", "created_at"');
  });

  it('reads the generated key from the driver, so the insert stays plain', () => {
    expect(grammar.supportsReturning()).toBe(true);
    expect(grammar.usesLastInsertId()).toBe(true);
    expect(grammar.compileInsertGetId(queryState(), { name: 'a' })).toBe('INSERT INTO "users" ("name") VALUES (?)');
  });

  it('compiles a count aggregate the way the builder expects the alias', () => {
    expect(grammar.compileAggregate('COUNT', '*')).toBe('COUNT(*) as aggregate');
    expect(grammar.compileAggregate('max', 'votes')).toBe('MAX("votes") as aggregate');
  });

  it('truncates with DELETE, because SQLite has no TRUNCATE TABLE', () => {
    expect(grammar.compileTruncate(queryState({ table: 'logs' }))).toBe('DELETE FROM "logs"');
  });

  it('renders literals for display with SQLite spellings', () => {
    const sql = grammar.substituteBindings(
      'SELECT * FROM "users" WHERE "name" = ? AND "active" = ? AND "bio" = ? AND "id" = ?',
      ["O'Brien", true, null, 7]
    );

    expect(sql).toBe(`SELECT * FROM "users" WHERE "name" = 'O''Brien' AND "active" = 1 AND "bio" = NULL AND "id" = 7`);
  });

  it('does not substitute inside quoted regions', () => {
    expect(grammar.substituteBindings(`SELECT '?' as q, name FROM t WHERE x = ?`, ['v'])).toBe(
      `SELECT '?' as q, name FROM t WHERE x = 'v'`
    );
  });

  it('rejects an unknown operator instead of emitting it', () => {
    expect(() =>
      grammar.compileWheres(queryState({ wheres: [{ column: 'a', operator: '= 1 OR 1', value: 1, boolean: 'and' }] }))
    ).toThrow(/Unsupported operator/);
  });

  it('rejects an unknown order direction', () => {
    expect(() => grammar.compileOrders(queryState({ orders: [{ column: 'a', direction: 'asc; --' as any }] }))).toThrow(
      /Unsupported order direction/
    );
  });
});
