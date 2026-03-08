/**
 * Migrator tests
 *
 * Covers core Migrator behaviour with a fully-mocked Connection so no real
 * database is required.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Migrator } from '@/Database/Migrations/Migrator';
import { Connection } from '@/Database/Connection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Connection stub.  Only the methods the Migrator actually
 * calls need to be present.
 */
function makeConnection(overrides: Partial<Record<string, any>> = {}): Connection {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    select: vi.fn().mockResolvedValue([]),
    table: vi.fn().mockReturnValue({
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockResolvedValue(1),
      delete: vi.fn().mockResolvedValue(1),
      max: vi.fn().mockResolvedValue(null),
    }),
    // SchemaBuilder reads getConfig().driver in its constructor
    getConfig: vi.fn().mockReturnValue({ driver: 'sqlite', database: ':memory:' }),
    getAdapter: vi.fn().mockReturnValue({}),
    getTables: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as Connection;
}

// ---------------------------------------------------------------------------
// dropAllTables
// ---------------------------------------------------------------------------

describe('Migrator.dropAllTables()', () => {
  it('drops every table returned by connection.getTables()', async () => {
    const querySpy = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const connection = makeConnection({
      getTables: vi.fn().mockResolvedValue(['users', 'projects', 'audit_events', 'migrations']),
      query: querySpy,
    });

    const migrator = new Migrator(connection, []);
    await migrator.dropAllTables();

    // One DROP TABLE call per table
    expect(querySpy).toHaveBeenCalledTimes(4);
    expect(querySpy).toHaveBeenCalledWith('DROP TABLE IF EXISTS users');
    expect(querySpy).toHaveBeenCalledWith('DROP TABLE IF EXISTS projects');
    expect(querySpy).toHaveBeenCalledWith('DROP TABLE IF EXISTS audit_events');
    expect(querySpy).toHaveBeenCalledWith('DROP TABLE IF EXISTS migrations');
  });

  it('issues no queries when the database is empty', async () => {
    const querySpy = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const connection = makeConnection({
      getTables: vi.fn().mockResolvedValue([]),
      query: querySpy,
    });

    const migrator = new Migrator(connection, []);
    await migrator.dropAllTables();

    expect(querySpy).not.toHaveBeenCalled();
  });

  it('drops tables in the order returned by getTables()', async () => {
    const dropOrder: string[] = [];
    const querySpy = vi.fn().mockImplementation((sql: string) => {
      dropOrder.push(sql);
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const tables = ['reports', 'users', 'migrations'];
    const connection = makeConnection({
      getTables: vi.fn().mockResolvedValue(tables),
      query: querySpy,
    });

    const migrator = new Migrator(connection, []);
    await migrator.dropAllTables();

    expect(dropOrder).toEqual([
      'DROP TABLE IF EXISTS reports',
      'DROP TABLE IF EXISTS users',
      'DROP TABLE IF EXISTS migrations',
    ]);
  });
});

// ---------------------------------------------------------------------------
// run() – basic behaviour (regression guard)
// ---------------------------------------------------------------------------

describe('Migrator.run()', () => {
  it('returns empty array when no pending migrations exist', async () => {
    const connection = makeConnection();

    // Stub getMigrationFiles to return [] via the fs layer - simplest is to
    // spy on the method directly after construction.
    const migrator = new Migrator(connection, []);
    vi.spyOn(migrator, 'getMigrationFiles').mockResolvedValue([]);

    const ran = await migrator.run();

    expect(ran).toEqual([]);
  });
});
