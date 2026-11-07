import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DrizzleAdapter } from '@/Database/Adapters/DrizzleAdapter';
import { Connection } from '@/Database/Connection';
import { DatabaseAdapter } from '@/Database/Contracts/DatabaseAdapter';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';

/**
 * better-sqlite3 is an optional dependency (and needs a native build), so the
 * integration suite only runs when the driver is actually installed. The JS
 * wrapper imports fine even without a compiled binding - `bindings()` only
 * resolves when a Database is constructed - so probe by opening a real
 * in-memory connection.
 */
async function hasBetterSqlite(): Promise<boolean> {
  try {
    const Database = await import('better-sqlite3');
    const db = new Database.default(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

const SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT
  )
`;

const WITH_BETTER_SQLITE = await hasBetterSqlite();

describe.skipIf(!WITH_BETTER_SQLITE)('Connection.transaction (better-sqlite3)', () => {
  let adapter: DrizzleAdapter;
  let manager: DatabaseManager;
  let connection: Connection;

  beforeEach(async () => {
    adapter = new DrizzleAdapter({ driver: 'better-sqlite3', database: ':memory:' });
    await adapter.connect();
    await adapter.query(SCHEMA);

    manager = new DatabaseManager({
      default: 'main',
      connections: {
        main: { adapter: 'drizzle', driver: 'better-sqlite3', database: ':memory:' },
      },
    });
    manager.registerAdapter('drizzle', () => adapter);
    Ensemble.setConnectionResolver(manager);

    connection = manager.connection();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  async function names(): Promise<string[]> {
    const rows = await adapter.select<{ name: string }>('SELECT name FROM users ORDER BY id');
    return rows.map((row) => row.name);
  }

  it('passes the same connection to the callback and commits its table writes', async () => {
    const seen: Connection[] = [];

    const result = await connection.transaction(async (db) => {
      seen.push(db);
      await db.table('users').insert({ name: 'ada' });
      return 'done';
    });

    expect(result).toBe('done');
    expect(seen).toEqual([connection]);
    expect(await names()).toEqual(['ada']);
  });

  it('leaves no inserted row when the callback throws', async () => {
    await expect(
      connection.transaction(async (db) => {
        await db.table('users').insert({ name: 'ghost' });
        throw new Error('x');
      })
    ).rejects.toThrow('x');

    expect(await names()).toEqual([]);
  });

  it('keeps outer writes intact when an inner transaction rolls back', async () => {
    await connection.transaction(async (db) => {
      await db.table('users').insert({ name: 'outer' });

      try {
        await db.transaction(async (inner) => {
          await inner.table('users').insert({ name: 'inner' });
          throw new Error('inner failed');
        });
      } catch (error: any) {
        expect(error.message).toBe('inner failed');
      }

      // The outer transaction is still open after the savepoint rollback.
      expect(adapter.isConnected()).toBe(true);
    });

    expect(await names()).toEqual(['outer']);
  });

  it('persists inner and outer writes when the nested transaction commits', async () => {
    await connection.transaction(async (db) => {
      await db.table('users').insert({ name: 'outer' });

      await db.transaction(async (inner) => {
        await inner.table('users').insert({ name: 'inner' });
      });
    });

    expect(await names()).toEqual(['outer', 'inner']);
  });

  it('routes Ensemble model writes through the transaction and rolls them back', async () => {
    class TxUser extends Ensemble {
      static fillable = ['name'];
      protected table = 'users';
      protected timestamps: boolean = false;
    }

    await expect(
      connection.transaction(async () => {
        const user = await TxUser.create({ name: 'grace' });
        expect(user.getKey()).not.toBeUndefined();
        throw new Error('x');
      })
    ).rejects.toThrow('x');

    expect(await names()).toEqual([]);
  });

  it('persists Ensemble model writes when the transaction commits', async () => {
    class TxUser extends Ensemble {
      static fillable = ['name'];
      protected table = 'users';
      protected timestamps: boolean = false;
    }

    await connection.transaction(async () => {
      await TxUser.create({ name: 'grace' });
    });

    expect(await names()).toEqual(['grace']);
    expect(await TxUser.all()).toHaveLength(1);
  });

  it('leaves the connection usable after a rolled-back transaction', async () => {
    await expect(
      connection.transaction(async (db) => {
        await db.table('users').insert({ name: 'ghost' });
        throw new Error('x');
      })
    ).rejects.toThrow('x');

    expect((adapter as any).transactionClient).toBeNull();

    await connection.table('users').insert({ name: 'after' });
    expect(await names()).toEqual(['after']);
  });
});

describe('Connection.transaction attempts', () => {
  interface RecordingAdapter extends Partial<DatabaseAdapter> {
    beginTransaction: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    rollback: ReturnType<typeof vi.fn>;
  }

  function fakeAdapter(overrides: Partial<DatabaseAdapter> = {}): RecordingAdapter {
    return {
      beginTransaction: vi.fn(async () => {}),
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
      ...overrides,
    } as RecordingAdapter;
  }

  function connectionWith(adapter: Partial<DatabaseAdapter>): Connection {
    const connection = new Connection(adapter as DatabaseAdapter, { driver: 'sqlite', database: 'db' });
    (connection as any).deadlockRetryDelayMs = 0;
    return connection;
  }

  function driverError(message: string, extra: Record<string, any>, wrapped = true): Error {
    const error = Object.assign(new Error(message), extra);
    // The adapter wraps driver failures with the original error as `cause`.
    return wrapped ? new Error(`Query failed: ${message}\nSQL: INSERT ...`, { cause: error }) : error;
  }

  it.each([
    ['ER_LOCK_DEADLOCK', { code: 'ER_LOCK_DEADLOCK' }],
    ['ER_LOCK_WAIT_TIMEOUT', { code: 'ER_LOCK_WAIT_TIMEOUT' }],
    ['errno 1213', { errno: 1213 }],
    ['errno 1205', { errno: 1205 }],
    ['postgres 40P01', { code: '40P01' }],
    ['postgres 40001', { code: '40001' }],
    ['SQLITE_BUSY', { code: 'SQLITE_BUSY' }],
    ['SQLITE_LOCKED', { code: 'SQLITE_LOCKED' }],
  ])('retries on %s failures', async (_label, extra) => {
    const adapter = fakeAdapter();
    const connection = connectionWith(adapter);

    let attempts = 0;
    const result = await connection.transaction(async () => {
      attempts += 1;

      if (attempts === 1) {
        throw driverError('deadlock found', extra);
      }

      return attempts;
    }, 2);

    expect(result).toBe(2);
    expect(adapter.beginTransaction).toHaveBeenCalledTimes(2);
    expect(adapter.rollback).toHaveBeenCalledTimes(1);
    expect(adapter.commit).toHaveBeenCalledTimes(1);
  });

  it('does not retry errors that are not deadlocks', async () => {
    const adapter = fakeAdapter();
    const connection = connectionWith(adapter);

    await expect(
      connection.transaction(async () => {
        throw driverError('unique constraint violated', { code: 'ER_DUP_ENTRY', errno: 1062 });
      }, 3)
    ).rejects.toThrow('unique constraint violated');

    expect(adapter.beginTransaction).toHaveBeenCalledTimes(1);
    expect(adapter.rollback).toHaveBeenCalledTimes(1);
    expect(adapter.commit).not.toHaveBeenCalled();
  });

  it('gives up and rethrows once the attempts are exhausted', async () => {
    const adapter = fakeAdapter();
    const connection = connectionWith(adapter);

    await expect(
      connection.transaction(async () => {
        throw driverError('deadlock found', { code: 'ER_LOCK_DEADLOCK' });
      }, 2)
    ).rejects.toThrow('deadlock found');

    expect(adapter.beginTransaction).toHaveBeenCalledTimes(2);
    expect(adapter.rollback).toHaveBeenCalledTimes(2);
    expect(adapter.commit).not.toHaveBeenCalled();
  });

  it('defaults to a single attempt even for deadlocks', async () => {
    const adapter = fakeAdapter();
    const connection = connectionWith(adapter);

    await expect(
      connection.transaction(async () => {
        throw driverError('deadlock found', { code: 'ER_LOCK_DEADLOCK' });
      })
    ).rejects.toThrow('deadlock found');

    expect(adapter.beginTransaction).toHaveBeenCalledTimes(1);
    expect(adapter.rollback).toHaveBeenCalledTimes(1);
  });

  it('rolls back and re-begins so each retry is a fresh transaction', async () => {
    const events: string[] = [];
    const adapter = fakeAdapter();
    adapter.beginTransaction = vi.fn(async () => {
      events.push('begin');
    });
    adapter.rollback = vi.fn(async () => {
      events.push('rollback');
    });
    adapter.commit = vi.fn(async () => {
      events.push('commit');
    });

    const connection = connectionWith(adapter);

    let attempts = 0;
    await connection.transaction(async (db) => {
      attempts += 1;

      if (attempts === 1) {
        throw driverError('deadlock found', { code: 'ER_LOCK_DEADLOCK' }, false);
      }

      expect(db).toBe(connection);
    }, 2);

    expect(events).toEqual(['begin', 'rollback', 'begin', 'commit']);
    expect(attempts).toBe(2);
  });
});
