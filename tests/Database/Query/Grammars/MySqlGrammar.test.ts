import { describe, it, expect } from 'vitest';
import { MySqlGrammar } from '@/Database/Query/Grammars';
import { queryState } from '../support';

const grammar = new MySqlGrammar();

describe('MySqlGrammar', () => {
  it('quotes identifiers with backticks', () => {
    expect(grammar.wrap('key')).toBe('`key`');
    expect(grammar.wrap('users.key')).toBe('`users`.`key`');
    expect(grammar.wrapTable('logs')).toBe('`logs`');
    expect(grammar.wrap('users.*')).toBe('`users`.*');
    expect(grammar.wrap('user_id as pivot_user_id')).toBe('`user_id` as `pivot_user_id`');
  });

  it('has no RETURNING support and reads the key from the driver', () => {
    expect(grammar.supportsReturning()).toBe(false);
    expect(grammar.usesLastInsertId()).toBe(true);
  });

  it('leaves insertGetId as a plain insert', () => {
    expect(grammar.compileInsertGetId(queryState(), { name: 'Ada' })).toBe('INSERT INTO `users` (`name`) VALUES (?)');
  });

  it('refuses to compile a RETURNING clause', () => {
    expect(() => grammar.compileInsertReturning(queryState(), [{ name: 'Ada' }], ['id'])).toThrow(
      /does not support "RETURNING"/
    );
  });

  it('compiles update and delete with quoted identifiers', () => {
    expect(
      grammar.compileUpdate(queryState({ wheres: [{ column: 'users.id', operator: '=', value: 1, boolean: 'and' }] }), {
        name: 'Ada',
        votes: 2,
      })
    ).toBe('UPDATE `users` SET `name` = ?, `votes` = ? WHERE `users`.`id` = ?');

    expect(
      grammar.compileDelete(queryState({ wheres: [{ column: 'id', operator: 'in', value: [1, 2], boolean: 'and' }] }))
    ).toBe('DELETE FROM `users` WHERE `id` IN (?, ?)');

    expect(grammar.compileDelete(queryState())).toBe('DELETE FROM `users`');
  });

  it('truncates with TRUNCATE TABLE', () => {
    expect(grammar.compileTruncate(queryState({ table: 'logs' }))).toBe('TRUNCATE TABLE `logs`');
  });

  it('escapes MySQL string literals and renders booleans as tinyints', () => {
    const sql = grammar.substituteBindings('SELECT * FROM `t` WHERE `a` = ? AND `b` = ? AND `c` = ?', [
      'back\\slash',
      "quote'inside",
      false,
    ]);

    expect(sql).toBe(`SELECT * FROM \`t\` WHERE \`a\` = 'back\\\\slash' AND \`b\` = 'quote\\'inside' AND \`c\` = 0`);
  });

  it('treats backslash escapes as part of the literal when substituting', () => {
    const sql = grammar.substituteBindings("SELECT 'a\\'?' as x, name FROM t WHERE bio = ?", ['v']);

    expect(sql).toBe("SELECT 'a\\'?' as x, name FROM t WHERE bio = 'v'");
  });
});
