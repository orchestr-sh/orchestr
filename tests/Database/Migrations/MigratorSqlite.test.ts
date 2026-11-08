/**
 * Migrator against a real SQLite database
 *
 * The unit suite pins the Migrator's bookkeeping with a stubbed connection;
 * this one runs migrations through better-sqlite3, which is what proves the
 * generated `migrations` table works, that a failed migration leaves no half
 * applied schema behind because SQLite keeps DDL transactional, and that
 * `dropAllTables()` can clear a database that has live foreign keys.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Schema } from '@/Database/Contracts/Schema';
import { DrizzleAdapter } from '@/Database/Adapters/DrizzleAdapter';
import { Connection } from '@/Database/Connection';
import { Migration } from '@/Database/Migrations/Migration';
import { Migrator } from '@/Database/Migrations/Migrator';
import { WITH_BETTER_SQLITE } from '../support';

class CreateUsers extends Migration {
  constructor(private readonly failing = false) {
    super();
  }

  async up(schema: Schema): Promise<void> {
    await schema.create('users', (table) => {
      table.id();
      table.string('email').unique();
    });

    if (this.failing) {
      throw new Error('Migration blew up halfway through');
    }
  }

  async down(schema: Schema): Promise<void> {
    await schema.drop('users');
  }
}

class CreatePosts extends Migration {
  async up(schema: Schema): Promise<void> {
    await schema.create('posts', (table) => {
      table.id();
      table.string('title');
      table.foreignId('user_id').constrained().cascadeOnDelete();
    });
  }

  async down(schema: Schema): Promise<void> {
    await schema.drop('posts');
  }
}

/**
 * A migrator whose migrations are given to it directly, so the suite is about
 * what the driver ends up doing rather than how files are discovered.
 */
class ScriptedMigrator extends Migrator {
  constructor(
    connection: Connection,
    private readonly migrations: Record<string, Migration>
  ) {
    super(connection, []);
  }

  protected override async resolveMigration(file: string): Promise<Migration> {
    return this.migrations[file];
  }

  override async getMigrationFiles(): Promise<string[]> {
    return Object.keys(this.migrations).sort();
  }
}

describe.skipIf(!WITH_BETTER_SQLITE)('Migrator (better-sqlite3)', () => {
  let adapter: DrizzleAdapter;
  let connection: Connection;

  beforeEach(async () => {
    adapter = new DrizzleAdapter({ driver: 'better-sqlite3', database: ':memory:' });
    await adapter.connect();

    connection = new Connection(adapter, { driver: 'better-sqlite3', database: ':memory:' });
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  const tableNames = async () =>
    (await connection.select(`SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' ORDER BY "name"`))
      .map((row) => row.name)
      .filter((name: string) => !name.startsWith('sqlite_'));

  it('creates the migrations table through the schema grammar', async () => {
    const migrator = new ScriptedMigrator(connection, { '01_users': new CreateUsers() });

    await migrator.run();

    const columns = await connection.select('PRAGMA table_info("migrations")');
    expect(columns.map((column) => column.name)).toEqual(['id', 'migration', 'batch']);

    // The tracking key is a real auto-incrementing primary key.
    expect(columns[0].pk).toBe(1);

    const rows = await connection.table('migrations').orderBy('id', 'asc').get();
    expect(rows).toEqual([{ id: 1, migration: '01_users', batch: 1 }]);
  });

  it('records every pending migration in one batch', async () => {
    const migrator = new ScriptedMigrator(connection, {
      '01_users': new CreateUsers(),
      '02_posts': new CreatePosts(),
    });

    const ran = await migrator.run();

    expect(ran).toEqual(['01_users', '02_posts']);
    expect(await tableNames()).toEqual(['migrations', 'posts', 'users']);
    expect(await connection.table('migrations').count()).toBe(2);
    expect(await migrator.getRan()).toEqual(['01_users', '02_posts']);
  });

  it('gives each migration its own batch when stepping', async () => {
    const migrator = new ScriptedMigrator(connection, {
      '01_users': new CreateUsers(),
      '02_posts': new CreatePosts(),
    });

    await migrator.run({ step: true });

    const batches = await migrator.getMigrationBatches();
    expect(batches).toEqual({ '01_users': 1, '02_posts': 2 });
  });

  it('rolls a failed migration back, leaving no half applied schema', async () => {
    const migrator = new ScriptedMigrator(connection, { '01_users': new CreateUsers(true) });

    await expect(migrator.run()).rejects.toThrow('Migration blew up halfway through');

    // SQLite keeps DDL inside the transaction, so the table the migration had
    // already created is gone again, and it is not recorded as run.
    expect(await tableNames()).toEqual(['migrations']);
    expect(await migrator.getRan()).toEqual([]);
  });

  it('does not run anything in pretend mode', async () => {
    const migrator = new ScriptedMigrator(connection, { '01_users': new CreateUsers() });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await migrator.run({ pretend: true })).toEqual(['01_users']);

    expect(await tableNames()).toEqual(['migrations']);
    expect(log).toHaveBeenCalledWith('Would run: 01_users');

    log.mockRestore();
  });

  it('rolls back the last batch and drops its tables', async () => {
    const migrator = new ScriptedMigrator(connection, {
      '01_users': new CreateUsers(),
      '02_posts': new CreatePosts(),
    });

    await migrator.run({ step: true });
    const rolledBack = await migrator.rollback();

    // Only the newest batch rolls back, and its table goes with it.
    expect(rolledBack).toEqual(['02_posts']);
    expect(await tableNames()).toEqual(['migrations', 'users']);
    expect(await migrator.getRan()).toEqual(['01_users']);
  });

  it('drops every table, including ones that reference each other', async () => {
    const migrator = new ScriptedMigrator(connection, {
      '01_users': new CreateUsers(),
      '02_posts': new CreatePosts(),
    });

    await migrator.run();
    await connection.table('users').insert({ email: 'ada@example.com' });
    await connection.table('posts').insert({ title: 'First', user_id: 1 });

    await migrator.dropAllTables();

    expect(await tableNames()).toEqual([]);

    // The pragma that switched constraints off is switched back on afterwards.
    const [{ foreign_keys }] = await connection.select('PRAGMA foreign_keys');
    expect(foreign_keys).toBe(1);
  });

  it('re-runs migrations on refresh', async () => {
    const migrator = new ScriptedMigrator(connection, {
      '01_users': new CreateUsers(),
      '02_posts': new CreatePosts(),
    });

    await migrator.run();
    const result = await migrator.refresh();

    expect([...result.rolledBack].sort()).toEqual(['01_users', '02_posts']);
    expect([...result.ran].sort()).toEqual(['01_users', '02_posts']);
    expect(await tableNames()).toEqual(['migrations', 'posts', 'users']);
    expect(await connection.table('migrations').count()).toBe(2);
  });

  it('keeps data untouched when a migration that does nothing is added', async () => {
    const migrator = new ScriptedMigrator(connection, {
      '01_users': new CreateUsers(),
      '02_posts': new CreatePosts(),
    });

    await migrator.run();
    await connection.table('users').insert({ email: 'grace@example.com' });

    const again = await new ScriptedMigrator(connection, {
      '01_users': new CreateUsers(),
      '02_posts': new CreatePosts(),
    }).run();

    expect(again).toEqual([]);
    expect(await connection.table('users').count()).toBe(1);
  });
});
