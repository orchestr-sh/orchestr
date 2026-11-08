/**
 * Migrator tests
 *
 * Covers core Migrator behaviour with a fully-mocked Connection so no real
 * database is required. The migration files themselves are resolved through an
 * overridable `resolveMigration`, which keeps the suite about batching,
 * transactions and tracking rather than the module loader.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '@/Database/Connection';
import type { Migration } from '@/Database/Migrations/Migration';
import { Migrator, type MigrationOptions } from '@/Database/Migrations/Migrator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * One row of the fake `migrations` table.
 */
type MigrationRow = { migration: string; batch: number };

/**
 * A fake `migrations` table: rows the repository inserts, deletes and reads
 * back through the query builder, so batch numbers and rollback ordering behave
 * like the real thing.
 */
interface FakeRepository {
  rows: MigrationRow[];
  calls: string[];
}

/**
 * Read a row's column by name: the fake builder filters and sorts on whichever
 * column the Migrator happens to ask for, so it is only known as a string.
 */
function fieldValue(row: MigrationRow, column: string): any {
  return row[column as keyof MigrationRow];
}

/**
 * One query builder over the fake table. Ordering, filtering and limits are
 * recorded per call, because the repository reads the table back in different
 * orders depending on what it is being asked.
 */
function makeBuilder(repository: FakeRepository): any {
  const wheres: Array<{ column: string; value: any }> = [];
  const orders: Array<{ column: string; direction: string }> = [];
  let limit: number | undefined;

  const builder: any = {
    orderBy: vi.fn((column: string, direction = 'asc') => {
      orders.push({ column, direction });

      return builder;
    }),
    where: vi.fn((column: string, operatorOrValue: any, value?: any) => {
      wheres.push({ column, value: value === undefined ? operatorOrValue : value });

      return builder;
    }),
    limit: vi.fn((count: number) => {
      limit = count;

      return builder;
    }),
    get: vi.fn(async () => {
      let rows = repository.rows.filter((row) =>
        wheres.every(({ column, value }) => fieldValue(row, column) === value)
      );

      for (const order of [...orders].reverse()) {
        rows = [...rows].sort((a, b) => {
          const left = fieldValue(a, order.column) as number;
          const right = fieldValue(b, order.column) as number;

          return order.direction === 'desc' ? right - left : left - right;
        });
      }

      return limit === undefined ? rows : rows.slice(0, limit);
    }),
    insert: vi.fn(async (record: MigrationRow) => {
      repository.rows.push(record);
      repository.calls.push(`log:${record.migration}:${record.batch}`);

      return 1;
    }),
    delete: vi.fn(async () => {
      const target = wheres.at(-1);

      repository.rows = repository.rows.filter((row) => fieldValue(row, target!.column) !== target!.value);
      repository.calls.push(`unlog:${target!.value}`);

      return 1;
    }),
    max: vi.fn(async () => (repository.rows.length > 0 ? Math.max(...repository.rows.map((row) => row.batch)) : null)),
  };

  return builder;
}

/**
 * Build a minimal Connection stub.  Only the methods the Migrator actually
 * calls need to be present.
 */
function makeConnection(
  overrides: Partial<Record<string, any>> = {},
  repository: FakeRepository = { rows: [], calls: [] }
): Connection {
  const connection: any = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    select: vi.fn().mockResolvedValue([]),
    table: vi.fn(() => makeBuilder(repository)),
    transaction: vi.fn(async (callback: (connection: Connection) => Promise<void>) => {
      repository.calls.push('begin');

      try {
        await callback(connection as Connection);
        repository.calls.push('commit');
      } catch (error) {
        repository.calls.push('rollback');
        throw error;
      }
    }),
    // SchemaBuilder reads getConfig().driver in its constructor
    getConfig: vi.fn().mockReturnValue({ driver: 'sqlite', database: ':memory:' }),
    getAdapter: vi.fn().mockReturnValue({}),
    getTables: vi.fn().mockResolvedValue([]),
    ...overrides,
  };

  return connection as Connection;
}

/**
 * A Migrator whose migrations are the ones handed to it, so no files or module
 * loading are involved.
 */
class ScriptedMigrator extends Migrator {
  constructor(
    connection: Connection,
    private readonly migrations: Record<string, Migration>
  ) {
    super(connection, []);
  }

  protected override async resolveMigration(file: string): Promise<Migration> {
    const migration = this.migrations[file];

    if (!migration) {
      throw new Error(`No scripted migration for ${file}`);
    }

    return migration;
  }

  override async getMigrationFiles(): Promise<string[]> {
    return Object.keys(this.migrations);
  }
}

function migration(
  name: string,
  behaviour: { up?: (schema: any) => Promise<void>; down?: (schema: any) => Promise<void> } = {}
): Migration {
  return {
    up: vi.fn(async (schema: any) => behaviour.up?.(schema)),
    down: vi.fn(async (schema: any) => behaviour.down?.(schema)),
  } as unknown as Migration;
}

// ---------------------------------------------------------------------------
// dropAllTables
// ---------------------------------------------------------------------------

describe('Migrator.dropAllTables()', () => {
  it('drops every table returned by connection.getTables() with constraints off', async () => {
    const repository: FakeRepository = { rows: [], calls: [] };
    const querySpy = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const connection = makeConnection(
      {
        getTables: vi.fn().mockResolvedValue(['users', 'projects', 'audit_events', 'migrations']),
        query: querySpy,
      },
      repository
    );

    const migrator = new Migrator(connection, []);
    await migrator.dropAllTables();

    // Constraints are switched off once, every table is dropped, and the switch
    // is put back. Table names arrive quoted, so a reserved word is safe.
    expect(querySpy.mock.calls.map(([sql]) => sql)).toEqual([
      'PRAGMA foreign_keys = OFF',
      'DROP TABLE IF EXISTS "users"',
      'DROP TABLE IF EXISTS "projects"',
      'DROP TABLE IF EXISTS "audit_events"',
      'DROP TABLE IF EXISTS "migrations"',
      'PRAGMA foreign_keys = ON',
    ]);
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
      'PRAGMA foreign_keys = OFF',
      'DROP TABLE IF EXISTS "reports"',
      'DROP TABLE IF EXISTS "users"',
      'DROP TABLE IF EXISTS "migrations"',
      'PRAGMA foreign_keys = ON',
    ]);
  });

  it('restores constraints when a drop fails', async () => {
    const querySpy = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('"users"')) {
        return Promise.reject(new Error('locked'));
      }

      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const connection = makeConnection({
      getTables: vi.fn().mockResolvedValue(['users']),
      query: querySpy,
    });

    await expect(new Migrator(connection, []).dropAllTables()).rejects.toThrow('locked');

    expect(querySpy.mock.calls.map(([sql]) => sql)).toEqual([
      'PRAGMA foreign_keys = OFF',
      'DROP TABLE IF EXISTS "users"',
      'PRAGMA foreign_keys = ON',
    ]);
  });
});

// ---------------------------------------------------------------------------
// run()
// ---------------------------------------------------------------------------

describe('Migrator.run()', () => {
  it('returns empty array when no pending migrations exist', async () => {
    const connection = makeConnection();

    const migrator = new Migrator(connection, []);
    vi.spyOn(migrator, 'getMigrationFiles').mockResolvedValue([]);

    const ran = await migrator.run();

    expect(ran).toEqual([]);
  });

  it('logs every pending migration in one batch', async () => {
    const repository: FakeRepository = { rows: [], calls: [] };
    const connection = makeConnection({}, repository);
    const first = migration('01_first');
    const second = migration('02_second');

    const migrator = new ScriptedMigrator(connection, { '01_first': first, '02_second': second });
    const ran = await migrator.run();

    expect(ran).toEqual(['01_first', '02_second']);
    expect(first.up).toHaveBeenCalledTimes(1);
    expect(repository.rows).toEqual([
      { migration: '01_first', batch: 1 },
      { migration: '02_second', batch: 1 },
    ]);
  });

  it('skips migrations that are already recorded', async () => {
    const repository: FakeRepository = { rows: [{ migration: '01_first', batch: 1 }], calls: [] };
    const connection = makeConnection({}, repository);
    const second = migration('02_second');

    const migrator = new ScriptedMigrator(connection, { '01_first': migration('01_first'), '02_second': second });
    const ran = await migrator.run();

    expect(ran).toEqual(['02_second']);
    expect(second.up).toHaveBeenCalledTimes(1);
  });

  it('puts each migration in its own batch when stepping', async () => {
    const repository: FakeRepository = { rows: [], calls: [] };
    const connection = makeConnection({}, repository);

    const migrator = new ScriptedMigrator(connection, {
      '01_first': migration('01_first'),
      '02_second': migration('02_second'),
      '03_third': migration('03_third'),
    });

    await migrator.run({ step: true });

    expect(repository.rows).toEqual([
      { migration: '01_first', batch: 1 },
      { migration: '02_second', batch: 2 },
      { migration: '03_third', batch: 3 },
    ]);
  });

  it('runs each migration in its own transaction when the driver supports DDL transactions', async () => {
    const repository: FakeRepository = { rows: [], calls: [] };
    const connection = makeConnection({}, repository);

    const migrator = new ScriptedMigrator(connection, {
      '01_first': migration('01_first'),
      '02_second': migration('02_second'),
    });

    await migrator.run();

    // One transaction per migration, and the log entry is inside it, so a
    // failure cannot leave half a schema behind with nothing recorded.
    expect(repository.calls).toEqual(['begin', 'log:01_first:1', 'commit', 'begin', 'log:02_second:1', 'commit']);
  });

  it('runs without a transaction on a driver that commits DDL implicitly', async () => {
    const repository: FakeRepository = { rows: [], calls: [] };
    const connection = makeConnection(
      {
        getConfig: vi.fn().mockReturnValue({ driver: 'mysql', database: 'db' }),
      },
      repository
    );

    const migrator = new ScriptedMigrator(connection, { '01_first': migration('01_first') });
    await migrator.run();

    expect(connection.transaction).not.toHaveBeenCalled();
    expect(repository.rows).toEqual([{ migration: '01_first', batch: 1 }]);
  });

  it('rolls the transaction back and records nothing when a migration fails', async () => {
    const repository: FakeRepository = { rows: [], calls: [] };
    const connection = makeConnection({}, repository);

    const failing = migration('02_fails', {
      up: async () => {
        throw new Error('bad schema');
      },
    });

    const migrator = new ScriptedMigrator(connection, { '01_ok': migration('01_ok'), '02_fails': failing });

    await expect(migrator.run()).rejects.toThrow('bad schema');

    expect(repository.calls).toEqual(['begin', 'log:01_ok:1', 'commit', 'begin', 'rollback']);
    expect(repository.rows).toEqual([{ migration: '01_ok', batch: 1 }]);
  });

  it('does not touch the database in pretend mode', async () => {
    const repository: FakeRepository = { rows: [], calls: [] };
    const connection = makeConnection({}, repository);
    const first = migration('01_first');

    const migrator = new ScriptedMigrator(connection, { '01_first': first });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const ran = await migrator.run({ pretend: true });

    expect(ran).toEqual(['01_first']);
    expect(first.up).not.toHaveBeenCalled();
    expect(connection.transaction).not.toHaveBeenCalled();
    expect(repository.calls).toEqual([]);
    expect(log).toHaveBeenCalledWith('Would run: 01_first');

    log.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// createRepository() and rollback()
// ---------------------------------------------------------------------------

describe('Migrator.createRepository()', () => {
  it('creates the migration table through the schema grammar', async () => {
    const querySpy = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const connection = makeConnection({ query: querySpy });

    await new Migrator(connection, []).createRepository();

    // `select` answers that the table does not exist yet, so the create runs,
    // with the id column as the primary key SQLite needs.
    expect(querySpy).toHaveBeenCalledWith(
      'CREATE TABLE "migrations" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "migration" VARCHAR(255) NOT NULL, "batch" INTEGER NOT NULL)'
    );
  });

  it('leaves an existing migration table alone', async () => {
    const querySpy = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const connection = makeConnection({
      query: querySpy,
      select: vi.fn().mockResolvedValue([{ name: 'migrations' }]),
    });

    await new Migrator(connection, []).createRepository();

    expect(querySpy).not.toHaveBeenCalled();
  });

  it('creates the migration table for the driver in use', async () => {
    const querySpy = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const connection = makeConnection({
      query: querySpy,
      getConfig: vi.fn().mockReturnValue({ driver: 'mysql', database: 'db' }),
    });

    await new Migrator(connection, []).createRepository();

    expect(querySpy).toHaveBeenCalledWith(
      'CREATE TABLE `migrations` (`id` INT UNSIGNED NOT NULL AUTO_INCREMENT, `migration` VARCHAR(255) NOT NULL, `batch` INT NOT NULL, PRIMARY KEY (`id`))'
    );
  });
});

describe('Migrator.rollback()', () => {
  it('rolls back the last batch and forgets those migrations', async () => {
    const repository: FakeRepository = {
      rows: [
        { migration: '01_first', batch: 1 },
        { migration: '02_second', batch: 2 },
      ],
      calls: [],
    };
    const connection = makeConnection({}, repository);
    const second = migration('02_second');

    const migrator = new ScriptedMigrator(connection, { '01_first': migration('01_first'), '02_second': second });
    const rolledBack = await migrator.rollback();

    expect(rolledBack).toEqual(['02_second']);
    expect(second.down).toHaveBeenCalledTimes(1);
    expect(repository.calls).toEqual(['begin', 'unlog:02_second', 'commit']);
    expect(repository.rows).toEqual([{ migration: '01_first', batch: 1 }]);
  });

  it('rolls back the requested number of migrations', async () => {
    const repository: FakeRepository = {
      rows: [
        { migration: '01_first', batch: 1 },
        { migration: '02_second', batch: 2 },
      ],
      calls: [],
    };
    const connection = makeConnection({}, repository);

    const migrator = new ScriptedMigrator(connection, {
      '01_first': migration('01_first'),
      '02_second': migration('02_second'),
    });
    const rolledBack = await migrator.rollback({ step: 2 });

    expect(rolledBack).toEqual(['02_second', '01_first']);
  });

  it('reports what would roll back in pretend mode without running it', async () => {
    const repository: FakeRepository = { rows: [{ migration: '01_first', batch: 1 }], calls: [] };
    const connection = makeConnection({}, repository);
    const first = migration('01_first');

    const migrator = new ScriptedMigrator(connection, { '01_first': first });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await migrator.rollback({ pretend: true })).toEqual(['01_first']);
    expect(first.down).not.toHaveBeenCalled();
    expect(repository.calls).toEqual([]);

    log.mockRestore();
  });
});

describe('Migrator.refresh()', () => {
  it('resets every migration and runs them again', async () => {
    const repository: FakeRepository = { rows: [{ migration: '01_first', batch: 1 }], calls: [] };
    const connection = makeConnection({}, repository);

    const migrator = new ScriptedMigrator(connection, { '01_first': migration('01_first') });
    const result = await migrator.refresh();

    expect(result).toEqual({ rolledBack: ['01_first'], ran: ['01_first'] });
    expect(repository.rows).toEqual([{ migration: '01_first', batch: 1 }]);
  });

  it('rolls back only the requested number of migrations', async () => {
    const repository: FakeRepository = {
      rows: [
        { migration: '01_first', batch: 1 },
        { migration: '02_second', batch: 2 },
      ],
      calls: [],
    };
    const connection = makeConnection({}, repository);

    const options: MigrationOptions = { step: 1 };
    const migrator = new ScriptedMigrator(connection, {
      '01_first': migration('01_first'),
      '02_second': migration('02_second'),
    });

    const result = await migrator.refresh(options);

    expect(result.rolledBack).toEqual(['02_second']);
    expect(result.ran).toEqual(['02_second']);
  });
});
