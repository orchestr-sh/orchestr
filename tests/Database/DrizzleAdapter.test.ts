import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DrizzleAdapter } from '@/Database/Adapters/DrizzleAdapter';
import { Builder } from '@/Database/Query/Builder';
import { SqliteGrammar } from '@/Database/Query/Grammars';
import { WITH_BETTER_SQLITE } from './support';

const INJECTION = "Robert'); DROP TABLE users;--";

const SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    bio TEXT,
    active INTEGER,
    joined_at TEXT
  )
`;

describe.skipIf(!WITH_BETTER_SQLITE)('DrizzleAdapter parameterized execution (better-sqlite3)', () => {
  let adapter: DrizzleAdapter;

  beforeEach(async () => {
    adapter = new DrizzleAdapter({ driver: 'better-sqlite3', database: ':memory:' });
    await adapter.connect();
    await adapter.query(SCHEMA);
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  it('stores an injection payload verbatim without altering the schema', async () => {
    const trailing = `"; DROP TABLE users; -- ${INJECTION}`;
    await adapter.insert('INSERT INTO users (name, bio) VALUES (?, ?)', [INJECTION, trailing]);

    const rows = await adapter.select<{ name: string; bio: string }>('SELECT name, bio FROM users WHERE name = ?', [
      INJECTION,
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(INJECTION);
    expect(rows[0].bio).toBe(trailing);
    expect(await adapter.getTables()).toEqual(['users']);
  });

  it('round-trips quotes, semicolons, comments, backslashes, newlines and question marks', async () => {
    const values = [
      "single 'quoted' value",
      'double "quoted" value',
      'semi; colon -- and /* block */ comment',
      'back\\slash and \\\\ doubled',
      'two\r\nlines and a\nnewline',
      'literal ? and ??? and ?',
      INJECTION,
      "doubled '' quotes",
      '',
    ];

    for (const value of values) {
      await adapter.insert('INSERT INTO users (name) VALUES (?)', [value]);
    }

    const rows = await adapter.select<{ name: string }>('SELECT name FROM users ORDER BY id');
    expect(rows.map((row) => row.name)).toEqual(values);
  });

  it('keeps binding order when a value contains a literal ?', async () => {
    await adapter.insert('INSERT INTO users (name, bio, active) VALUES (?, ?, ?)', ['?', 'after ?', true]);

    const rows = await adapter.select<{ name: string; bio: string; active: number }>(
      'SELECT name, bio, active FROM users WHERE name = ? AND bio = ? AND active = ?',
      ['?', 'after ?', 1]
    );

    expect(rows).toEqual([{ name: '?', bio: 'after ?', active: 1 }]);
  });

  it('binds null, boolean and Date values by position, not by text', async () => {
    const joined = new Date('2026-11-06T12:34:56.789Z');
    const id = await adapter.insert('INSERT INTO users (name, active, joined_at) VALUES (?, ?, ?)', [
      INJECTION,
      true,
      joined,
    ]);

    expect(await adapter.select('SELECT id FROM users WHERE joined_at = ?', [joined])).toEqual([{ id }]);
    expect(await adapter.select('SELECT id FROM users WHERE active = ?', [true])).toEqual([{ id }]);
    expect(await adapter.select('SELECT id FROM users WHERE active = ?', [false])).toEqual([]);

    const stored = await adapter.select<{ active: number; joined_at: string }>(
      'SELECT active, joined_at FROM users WHERE id = ?',
      [id]
    );
    expect(stored).toEqual([{ active: 1, joined_at: '2026-11-06T12:34:56.789Z' }]);
  });

  it('normalizes undefined bindings to null', async () => {
    const id = await adapter.insert('INSERT INTO users (name, bio) VALUES (?, ?)', ['Grace', undefined]);

    expect(await adapter.select<{ bio: string | null }>('SELECT bio FROM users WHERE id = ?', [id])).toEqual([
      { bio: null },
    ]);
  });

  it('fails loudly instead of stringifying objects and arrays', async () => {
    await expect(adapter.insert('INSERT INTO users (name) VALUES (?)', [{ nested: true }])).rejects.toThrow(
      /Cannot bind a value of type "object"/
    );
    await expect(adapter.select('SELECT * FROM users WHERE name IN (?)', [[1, 2]])).rejects.toThrow(
      /Cannot bind a value of type "array"/
    );

    expect(await adapter.select('SELECT * FROM users')).toEqual([]);
    expect(await adapter.getTables()).toEqual(['users']);
  });

  it('reports affected rows for update and delete', async () => {
    await adapter.insert('INSERT INTO users (name, active) VALUES (?, ?)', ['ada', true]);
    await adapter.insert('INSERT INTO users (name, active) VALUES (?, ?)', ['grace', false]);

    expect(await adapter.update('UPDATE users SET bio = ? WHERE active = ?', ['updated', true])).toBe(1);
    expect(await adapter.update('UPDATE users SET bio = ? WHERE name = ?', ['nobody', 'missing'])).toBe(0);
    expect(await adapter.delete('DELETE FROM users WHERE bio = ?', ['updated'])).toBe(1);

    const remaining = await adapter.select<{ name: string }>('SELECT name FROM users ORDER BY id');
    expect(remaining).toEqual([{ name: 'grace' }]);
  });

  it('preserves the QueryResult shape', async () => {
    await adapter.insert('INSERT INTO users (name) VALUES (?)', [INJECTION]);

    const result = await adapter.query<{ name: string }>('SELECT name FROM users WHERE name = ?', [INJECTION]);

    expect(result).toEqual({ rows: [{ name: INJECTION }], rowCount: 1 });
  });

  it('never writes bindings into the SQL handed to the driver', async () => {
    const database = (adapter as any).rawClient;
    const calls: Array<{ sql: string; args: any[] }> = [];

    (adapter as any).rawClient = {
      prepare(sql: string) {
        const statement = database.prepare(sql);
        const record = (args: any[]) => calls.push({ sql, args });

        return {
          get reader() {
            return statement.reader;
          },
          all: (...args: any[]) => {
            record(args);
            return statement.all(...args);
          },
          run: (...args: any[]) => {
            record(args);
            return statement.run(...args);
          },
          get: (...args: any[]) => {
            record(args);
            return statement.get(...args);
          },
        };
      },
    };

    await adapter.select('SELECT * FROM users WHERE name = ?', [INJECTION]);
    await adapter.insert('INSERT INTO users (name) VALUES (?)', [INJECTION]);

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.sql).toContain('?');
      expect(call.sql).not.toContain('Robert');
      expect(call.args).toEqual([INJECTION]);
    }
  });

  it('runs bound statements inside a transaction and rolls them back', async () => {
    await expect(
      adapter.transaction(async (tx) => {
        await tx.insert('INSERT INTO users (name) VALUES (?)', [INJECTION]);
        expect(await tx.select<{ name: string }>('SELECT name FROM users WHERE name = ?', [INJECTION])).toEqual([
          { name: INJECTION },
        ]);
        throw new Error('rollback please');
      })
    ).rejects.toThrow('rollback please');

    expect(await adapter.select('SELECT * FROM users')).toEqual([]);
  });

  it('commits bound statements through the shared execution helper', async () => {
    await adapter.transaction(async (tx) => {
      await tx.insert('INSERT INTO users (name, active) VALUES (?, ?)', [INJECTION, true]);
    });

    expect(await adapter.select<{ name: string }>('SELECT name FROM users WHERE active = ?', [true])).toEqual([
      { name: INJECTION },
    ]);
  });

  it('rolls a nested transaction back to its savepoint, keeping outer writes', async () => {
    await adapter.transaction(async (tx) => {
      await tx.insert('INSERT INTO users (name) VALUES (?)', ['outer']);

      try {
        await tx.transaction(async (inner) => {
          await inner.insert('INSERT INTO users (name) VALUES (?)', ['inner']);
          throw new Error('inner failed');
        });
      } catch (error: any) {
        expect(error.message).toBe('inner failed');
      }

      // The outer transaction survived the inner rollback and is still usable.
      await tx.insert('INSERT INTO users (name) VALUES (?)', ['after']);
    });

    const names = (await adapter.select<{ name: string }>('SELECT name FROM users ORDER BY id')).map((r) => r.name);
    expect(names).toEqual(['outer', 'after']);
  });

  it('keeps both inner and outer writes when the nested transaction commits', async () => {
    await adapter.transaction(async (tx) => {
      await tx.insert('INSERT INTO users (name) VALUES (?)', ['outer']);

      await tx.transaction(async (inner) => {
        await inner.insert('INSERT INTO users (name) VALUES (?)', ['inner']);
      });
    });

    const names = (await adapter.select<{ name: string }>('SELECT name FROM users ORDER BY id')).map((r) => r.name);
    expect(names).toEqual(['outer', 'inner']);
  });

  it('tracks the nesting depth and only ends the root transaction on commit', async () => {
    await adapter.beginTransaction();
    await adapter.insert('INSERT INTO users (name) VALUES (?)', ['a']);
    await adapter.beginTransaction();
    expect((adapter as any).transactionDepth).toBe(2);

    await adapter.rollback();
    expect((adapter as any).transactionDepth).toBe(1);
    expect((adapter as any).inTransaction).toBe(true);
    expect((adapter as any).transactionClient).not.toBeNull();

    await adapter.commit();
    expect((adapter as any).transactionDepth).toBe(0);
    expect((adapter as any).inTransaction).toBe(false);
    expect((adapter as any).transactionClient).toBeNull();

    expect(await adapter.select('SELECT name FROM users')).toEqual([{ name: 'a' }]);
  });

  it('clears the transaction state when a callback exception reaches the root', async () => {
    await expect(
      adapter.transaction(async (tx) => {
        await tx.transaction(async (inner) => {
          await inner.insert('INSERT INTO users (name) VALUES (?)', ['gone']);
          throw new Error('boom');
        });
      })
    ).rejects.toThrow('boom');

    expect((adapter as any).transactionDepth).toBe(0);
    expect((adapter as any).transactionClient).toBeNull();
    expect(await adapter.select('SELECT * FROM users')).toEqual([]);
  });

  it('issues the savepoint statements a nested transaction needs', async () => {
    const database = (adapter as any).rawClient;
    const control: string[] = [];

    (adapter as any).rawClient = {
      prepare(sql: string) {
        if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/.test(sql)) {
          control.push(sql);
        }
        return database.prepare(sql);
      },
    };

    await adapter.transaction(async (tx) => {
      try {
        await tx.transaction(async () => {
          throw new Error('rollback me');
        });
      } catch {
        // expected
      }

      await tx.transaction(async () => {
        // commits: RELEASE SAVEPOINT
      });
    });

    (adapter as any).rawClient = database;

    expect(control).toEqual([
      'BEGIN',
      'SAVEPOINT trans_1',
      'ROLLBACK TO trans_1',
      'SAVEPOINT trans_1',
      'RELEASE SAVEPOINT trans_1',
      'COMMIT',
    ]);
  });

  it('keeps the query builder on the parameterized path', async () => {
    await adapter.insert('INSERT INTO users (name, bio) VALUES (?, ?)', [INJECTION, 'plain']);
    await adapter.insert('INSERT INTO users (name, bio) VALUES (?, ?)', ['grace', '?safe']);

    const matched = await new Builder<{ name: string }>(adapter, new SqliteGrammar())
      .from('users')
      .select('name')
      .where('name', '=', INJECTION)
      .orWhere('bio', '=', '?safe')
      .get();
    expect(matched.map((row) => row.name).sort()).toEqual([INJECTION, 'grace'].sort());

    const inList = await new Builder<{ name: string }>(adapter, new SqliteGrammar())
      .from('users')
      .select('name')
      .whereIn('bio', ['?safe', '?danger'])
      .get();
    expect(inList).toEqual([{ name: 'grace' }]);

    const updated = await new Builder(adapter, new SqliteGrammar())
      .from('users')
      .where('bio', '=', '?safe')
      .update({ bio: INJECTION });
    expect(updated).toBe(1);

    const rows = await adapter.select<{ name: string }>('SELECT name FROM users WHERE bio = ?', [INJECTION]);
    expect(rows.map((row) => row.name)).toEqual(['grace']);
  });
});

describe('DrizzleAdapter driver transports', () => {
  function adapterWithClient(driver: string, client: any): DrizzleAdapter {
    const adapter = new DrizzleAdapter({ driver, database: 'database' });
    (adapter as any).connected = true;
    (adapter as any).rawClient = client;
    return adapter;
  }

  it('sends postgres bindings as $n parameters and keeps booleans native', async () => {
    const calls: Array<{ query: string; values: any[] }> = [];
    const adapter = adapterWithClient('postgres', {
      unsafe: (query: string, values: any[]) => {
        calls.push({ query, values });
        return Object.assign([], { count: 0 });
      },
    });

    await adapter.select('SELECT * FROM users WHERE name = ? AND active = ? AND joined_at > ?', [
      INJECTION,
      true,
      new Date('2026-01-01T00:00:00.000Z'),
    ]);

    expect(calls[0].query).toBe('SELECT * FROM users WHERE name = $1 AND active = $2 AND joined_at > $3');
    expect(calls[0].values).toEqual([INJECTION, true, '2026-01-01T00:00:00.000Z']);
  });

  it('leaves literal ? characters in postgres SQL text and comments untouched', async () => {
    const calls: Array<{ query: string; values: any[] }> = [];
    const adapter = adapterWithClient('postgres', {
      unsafe: (query: string, values: any[]) => {
        calls.push({ query, values });
        return [];
      },
    });

    await adapter.select("SELECT '?' AS question /* how? */, name FROM users WHERE bio = ? -- or?\n", ['x']);

    expect(calls[0].query).toBe("SELECT '?' AS question /* how? */, name FROM users WHERE bio = $1 -- or?\n");
    expect(calls[0].values).toEqual(['x']);
  });

  it('fails loudly when postgres placeholders and bindings disagree', async () => {
    const unsafe = vi.fn();
    const adapter = adapterWithClient('postgres', { unsafe });

    await expect(adapter.select('SELECT * FROM users WHERE a = ? AND b = ?', ['x'])).rejects.toThrow(/placeholder/);
    expect(unsafe).not.toHaveBeenCalled();
  });

  it('uses postgres affected rows for update and delete', async () => {
    const adapter = adapterWithClient('postgres', {
      unsafe: () => Object.assign([], { count: 3 }),
    });

    expect(await adapter.update('UPDATE users SET active = ? WHERE id = ?', [null, 1])).toBe(3);
    expect(await adapter.delete('DELETE FROM users WHERE name = ?', [INJECTION])).toBe(3);
  });

  it('passes mysql2 the statement plus a separate value array', async () => {
    const calls: Array<{ sql: string; values: any[] }> = [];
    const adapter = adapterWithClient('mysql', {
      execute: async (sql: string, values: any[]) => {
        calls.push({ sql, values });
        return [[{ name: INJECTION }], []];
      },
    });

    await adapter.query('SELECT * FROM users WHERE name = ? AND bio IS ?', [INJECTION, undefined]);

    expect(calls[0].sql).toBe('SELECT * FROM users WHERE name = ? AND bio IS ?');
    expect(calls[0].values).toEqual([INJECTION, null]);
  });

  it('reads mysql2 insert ids and affected-row counts from the result header', async () => {
    const adapter = adapterWithClient('mysql2', {
      execute: async () => [{ insertId: 7, affectedRows: 1 }, []],
    });

    expect(await adapter.insert('INSERT INTO users (name) VALUES (?)', [INJECTION])).toBe(7);
    expect(await adapter.update('UPDATE users SET name = ? WHERE id = ?', [INJECTION, 7])).toBe(1);
    expect(await adapter.delete('DELETE FROM users WHERE id = ?', [7])).toBe(1);
  });

  it('rejects unsupported drivers instead of falling back to interpolation', async () => {
    const adapter = adapterWithClient('sqlite3', { prepare: () => ({}) });

    await expect(adapter.select('SELECT * FROM users WHERE name = ?', ['x'])).rejects.toThrow(
      /Unsupported database driver/
    );
  });

  it('requires a connection before executing', async () => {
    const adapter = new DrizzleAdapter({ driver: 'better-sqlite3', database: ':memory:' });

    await expect(adapter.query('SELECT 1')).rejects.toThrow('Database not connected');
  });

  describe('postgres transaction connections', () => {
    function postgresFixture() {
      const calls: string[] = [];
      const release = vi.fn();
      const reserved = {
        unsafe: (query: string) => {
          calls.push(query);
          return Promise.resolve([]);
        },
        release,
      };
      const pool = {
        reserve: vi.fn(async () => reserved),
        unsafe: vi.fn(() => {
          calls.push('POOL:LEAK');
          return Promise.resolve([]);
        }),
      };
      return { calls, release, reserved, pool, adapter: adapterWithClient('postgres', pool) };
    }

    it('runs the whole transaction on one reserved connection and releases it on commit', async () => {
      const { calls, release, pool, adapter } = postgresFixture();

      await adapter.transaction(async (tx) => {
        await tx.insert('INSERT INTO users (name) VALUES (?)', ['ada']);
        await tx.select('SELECT * FROM users WHERE name = ?', ['ada']);
      });

      expect(pool.reserve).toHaveBeenCalledTimes(1);
      expect(calls).toEqual([
        'BEGIN',
        'INSERT INTO users (name) VALUES ($1)',
        'SELECT * FROM users WHERE name = $1',
        'COMMIT',
      ]);
      expect(release).toHaveBeenCalledTimes(1);
      expect((adapter as any).transactionClient).toBeNull();
      expect((adapter as any).transactionDepth).toBe(0);

      // After the transaction, queries go back to the pool itself.
      await adapter.select('SELECT * FROM users');
      expect(pool.unsafe).toHaveBeenCalledTimes(1);
    });

    it('rolls back and releases the reserved connection when the callback throws', async () => {
      const { calls, release, adapter } = postgresFixture();

      await expect(
        adapter.transaction(async (tx) => {
          await tx.insert('INSERT INTO users (name) VALUES (?)', ['ada']);
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');

      expect(calls).toEqual(['BEGIN', 'INSERT INTO users (name) VALUES ($1)', 'ROLLBACK']);
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('uses savepoints for nesting and holds the connection until the root ends', async () => {
      const { calls, release, adapter } = postgresFixture();

      await adapter.transaction(async (tx) => {
        try {
          await tx.transaction(async () => {
            throw new Error('inner failed');
          });
        } catch {
          // expected: inner rolls back to the savepoint only
        }

        await tx.transaction(async () => {
          // commits: releases the savepoint, keeps the transaction open
        });
      });

      expect(calls).toEqual([
        'BEGIN',
        'SAVEPOINT trans_1',
        'ROLLBACK TO trans_1',
        'SAVEPOINT trans_1',
        'RELEASE SAVEPOINT trans_1',
        'COMMIT',
      ]);
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('releases the reserved connection when BEGIN itself fails', async () => {
      const { release, adapter } = postgresFixture();
      (adapter as any).rawClient = {
        reserve: async () => ({
          unsafe: () => Promise.reject(new Error('no more connections')),
          release,
        }),
      };

      await expect(adapter.beginTransaction()).rejects.toThrow(/no more connections/);

      expect(release).toHaveBeenCalledTimes(1);
      expect((adapter as any).inTransaction).toBe(false);
      expect((adapter as any).transactionClient).toBeNull();
      expect((adapter as any).transactionDepth).toBe(0);
    });

    it('throws when committing or rolling back without a transaction', async () => {
      const { adapter, release } = postgresFixture();

      await expect(adapter.commit()).rejects.toThrow('No transaction in progress');
      await expect(adapter.rollback()).rejects.toThrow('No transaction in progress');
      expect(release).not.toHaveBeenCalled();
    });
  });

  describe('mysql2 transaction connections', () => {
    function mysqlFixture() {
      const connection = {
        beginTransaction: vi.fn(async () => {}),
        commit: vi.fn(async () => {}),
        rollback: vi.fn(async () => {}),
        query: vi.fn(async () => [[], []]),
        execute: vi.fn(async () => [{ affectedRows: 1, insertId: 7 }, []]),
        release: vi.fn(),
      };
      const pool = {
        getConnection: vi.fn(async () => connection),
        execute: vi.fn(async () => [[{ ok: true }], []]),
        query: vi.fn(),
      };
      return { connection, pool, adapter: adapterWithClient('mysql2', pool) };
    }

    it('checks out a pooled connection, runs everything on it, and releases it on commit', async () => {
      const { connection, pool, adapter } = mysqlFixture();

      const insertId = await adapter.transaction(async (tx) =>
        tx.insert('INSERT INTO users (name) VALUES (?)', ['ada'])
      );

      expect(pool.getConnection).toHaveBeenCalledTimes(1);
      expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
      expect(insertId).toBe(7);
      expect(connection.execute).toHaveBeenCalledWith('INSERT INTO users (name) VALUES (?)', ['ada']);
      expect(pool.execute).not.toHaveBeenCalled();
      expect(pool.query).not.toHaveBeenCalled();
      expect(connection.commit).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
      expect((adapter as any).transactionClient).toBeNull();

      await adapter.select('SELECT * FROM users');
      expect(pool.execute).toHaveBeenCalledTimes(1);
    });

    it('rolls back to savepoints inside nested transactions without touching the root', async () => {
      const { connection, adapter } = mysqlFixture();

      await adapter.transaction(async (tx) => {
        try {
          await tx.transaction(async (inner) => {
            await inner.insert('INSERT INTO users (name) VALUES (?)', ['inner']);
            throw new Error('inner failed');
          });
        } catch (error: any) {
          expect(error.message).toBe('inner failed');
        }

        await tx.insert('INSERT INTO users (name) VALUES (?)', ['outer']);
      });

      // Savepoint statements go through the text protocol on the checked-out
      // connection; the connection's rollback()/commit() are never triggered
      // by the inner failure.
      expect(connection.query).toHaveBeenCalledWith('SAVEPOINT trans_1');
      expect(connection.query).toHaveBeenCalledWith('ROLLBACK TO trans_1');
      expect(connection.rollback).not.toHaveBeenCalled();
      expect(connection.commit).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it('rolls back the pooled connection when the callback throws', async () => {
      const { connection, adapter } = mysqlFixture();

      await expect(
        adapter.transaction(async (tx) => {
          await tx.insert('INSERT INTO users (name) VALUES (?)', ['ada']);
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');

      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.commit).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it('releases the checked-out connection when BEGIN itself fails', async () => {
      const { connection, adapter } = mysqlFixture();
      connection.beginTransaction = vi.fn(async () => {
        throw new Error('server gone away');
      });

      await expect(adapter.beginTransaction()).rejects.toThrow('server gone away');

      expect(connection.release).toHaveBeenCalledTimes(1);
      expect((adapter as any).inTransaction).toBe(false);
      expect((adapter as any).transactionClient).toBeNull();
    });
  });
});
