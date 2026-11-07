import { describe, it, expect } from 'vitest';
import { PostgresGrammar } from '@/Database/Query/Grammars';
import { queryState } from '../support';

const grammar = new PostgresGrammar();

describe('PostgresGrammar', () => {
  it('quotes identifiers with double quotes', () => {
    expect(grammar.wrap('email')).toBe('"email"');
    expect(grammar.wrap('users.email')).toBe('"users"."email"');
    expect(grammar.wrapTable('public.users')).toBe('"public"."users"');
    expect(grammar.wrap('users.*')).toBe('"users".*');
  });

  it('quotes an aliased pivot column', () => {
    expect(grammar.wrap('project_user.user_id as pivot_user_id')).toBe('"project_user"."user_id" as "pivot_user_id"');
  });

  it('supports RETURNING but has no driver insert id', () => {
    expect(grammar.supportsReturning()).toBe(true);
    expect(grammar.usesLastInsertId()).toBe(false);
  });

  it('asks for the key column with RETURNING on insertGetId', () => {
    expect(grammar.compileInsertGetId(queryState(), { name: 'Ada' })).toBe(
      'INSERT INTO "users" ("name") VALUES (?) RETURNING "id"'
    );
  });

  it('honours the configured key instead of assuming one', () => {
    expect(grammar.compileInsertGetId(queryState(), { uuid: 'a1' }, 'uuid')).toBe(
      'INSERT INTO "users" ("uuid") VALUES (?) RETURNING "uuid"'
    );
    expect(grammar.compileInsertGetId(queryState({ returning: ['token'] }), { token: 'x' })).toBe(
      'INSERT INTO "users" ("token") VALUES (?) RETURNING "token"'
    );
  });

  it('names the key column it expects back', () => {
    expect(grammar.generatedKeyColumn(queryState(), 'uuid')).toBe('uuid');
    expect(grammar.generatedKeyColumn(queryState({ returning: ['*'] }))).toBe('id');
  });

  it('compiles RETURNING for the requested columns only', () => {
    expect(grammar.compileInsertReturning(queryState(), [{ name: 'Ada' }], ['id', 'email'])).toBe(
      'INSERT INTO "users" ("name") VALUES (?) RETURNING "id", "email"'
    );
    expect(grammar.compileInsertReturning(queryState(), [{ name: 'Ada' }], [])).toBe(
      'INSERT INTO "users" ("name") VALUES (?) RETURNING *'
    );
  });

  it('truncates with TRUNCATE TABLE', () => {
    expect(grammar.compileTruncate(queryState({ table: 'logs' }))).toBe('TRUNCATE TABLE "logs"');
  });

  it('renders PostgreSQL literals for display', () => {
    const sql = grammar.substituteBindings('SELECT * FROM "users" WHERE "a" = ? AND "b" = ? AND "c" = ?', [
      "O'Brien",
      true,
      12.5,
    ]);

    expect(sql).toBe(`SELECT * FROM "users" WHERE "a" = 'O''Brien' AND "b" = true AND "c" = 12.5`);
  });
});
