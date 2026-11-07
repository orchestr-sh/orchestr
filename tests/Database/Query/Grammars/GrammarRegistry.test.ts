/**
 * Grammar registry and connection wiring
 *
 * Adding a driver is supposed to mean adding a grammar here, not touching the
 * builder, and a connection has to hand its own grammar to every builder.
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseAdapter } from '@/Database/Contracts/DatabaseAdapter';
import { Connection } from '@/Database/Connection';
import {
  MySqlGrammar,
  PostgresGrammar,
  QueryGrammar,
  SqliteGrammar,
  grammarForDriver,
} from '@/Database/Query/Grammars';
import { recordAdapter } from '../support';

function connectionFor(driver: string, adapter: DatabaseAdapter = recordAdapter().adapter): Connection {
  return new Connection(adapter, { driver, database: 'db' });
}

describe('grammarForDriver', () => {
  it.each([
    ['sqlite', SqliteGrammar],
    ['better-sqlite3', SqliteGrammar],
    ['postgres', PostgresGrammar],
    ['pgsql', PostgresGrammar],
    ['mysql', MySqlGrammar],
    ['mysql2', MySqlGrammar],
  ])('maps the %s driver onto its grammar', (driver, Grammar) => {
    expect(grammarForDriver(driver)).toBeInstanceOf(Grammar);
  });

  it('is case insensitive about the configured driver', () => {
    expect(grammarForDriver('MySQL')).toBeInstanceOf(MySqlGrammar);
  });

  it('names the supported drivers when a grammar is missing', () => {
    expect(() => grammarForDriver('oracle')).toThrow(/No query grammar is registered for the \[oracle\] driver/);
    expect(() => grammarForDriver('oracle')).toThrow(/sqlite/);
  });

  it('gives every grammar the same compile surface', () => {
    const grammar = grammarForDriver('sqlite');

    expect(grammar).toBeInstanceOf(QueryGrammar);
    expect(typeof grammar.compileSelect).toBe('function');
    expect(typeof grammar.compileInsert).toBe('function');
    expect(typeof grammar.wrap).toBe('function');
    expect(typeof grammar.wrapTable).toBe('function');
  });
});

describe('Connection grammar wiring', () => {
  it('hands the connection grammar to every builder it creates', async () => {
    const { adapter, queries } = recordAdapter();
    const connection = new Connection(adapter, { driver: 'mysql', database: 'db' });

    expect(connection.getGrammar()).toBeInstanceOf(MySqlGrammar);
    expect(connection.table('users').getGrammar()).toBe(connection.getGrammar());

    await connection.table('users').where('id', 1).get();

    expect(queries[0].sql).toBe('SELECT * FROM `users` WHERE `id` = ?');
    expect(queries[0].bindings).toEqual([1]);
  });

  it('reuses one grammar instance for the connection', () => {
    const connection = connectionFor('sqlite');

    expect(connection.getGrammar()).toBe(connection.getGrammar());
    expect(connection.table('a').getGrammar()).toBe(connection.getGrammar());
  });

  it('only needs a grammar when a query is built', () => {
    // A connection can exist for a driver with no grammar, as long as nothing
    // compiled asks it to speak that dialect.
    expect(() => connectionFor('oracle')).not.toThrow();
    expect(() => connectionFor('oracle').getGrammar()).toThrow(/No query grammar is registered/);
    expect(() => connectionFor('oracle').table('users')).toThrow(/No query grammar is registered/);
  });
});
