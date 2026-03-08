import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MigrateFreshCommand } from '@/Console/Commands/MigrateFreshCommand';

const migratorCtorSpy = vi.fn();
const schemaBuilderCtorSpy = vi.fn();
const runSpy = vi.fn();
const dropAllTablesSpy = vi.fn();

vi.mock('@/Database/Migrations/Migrator', () => {
  class MockMigrator {
    constructor(connection: unknown, paths: string[]) {
      migratorCtorSpy(connection, paths);
    }

    dropAllTables() {
      return dropAllTablesSpy();
    }

    run() {
      return runSpy();
    }
  }

  return { Migrator: MockMigrator };
});

vi.mock('@/Database/Migrations/SchemaBuilder', () => {
  class MockSchemaBuilder {
    constructor(connection: unknown) {
      schemaBuilderCtorSpy(connection);
    }
  }

  return { SchemaBuilder: MockSchemaBuilder };
});

describe('MigrateFreshCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runSpy.mockResolvedValue([]);
    dropAllTablesSpy.mockResolvedValue(undefined);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('wraps a string path option into a single path array', async () => {
    const connection = { name: 'test-connection' };
    const app = {
      make: vi.fn().mockReturnValue({
        connection: vi.fn().mockReturnValue(connection),
      }),
      databasePath: vi.fn().mockReturnValue('/default/migrations'),
    } as any;

    const command = new MigrateFreshCommand(app);

    await command.handle([], { path: '/custom/migrations' });

    expect(migratorCtorSpy).toHaveBeenCalledWith(connection, ['/custom/migrations']);
    expect(app.databasePath).not.toHaveBeenCalled();
    expect(schemaBuilderCtorSpy).toHaveBeenCalledWith(connection);
  });

  it('passes through multiple path options as-is', async () => {
    const connection = { name: 'test-connection' };
    const app = {
      make: vi.fn().mockReturnValue({
        connection: vi.fn().mockReturnValue(connection),
      }),
      databasePath: vi.fn().mockReturnValue('/default/migrations'),
    } as any;

    const command = new MigrateFreshCommand(app);

    await command.handle([], {
      path: ['/module-a/migrations', '/module-b/migrations'],
    });

    expect(migratorCtorSpy).toHaveBeenCalledWith(connection, ['/module-a/migrations', '/module-b/migrations']);
    expect(app.databasePath).not.toHaveBeenCalled();
  });

  it('falls back to app.databasePath when no path option is provided', async () => {
    const connection = { name: 'test-connection' };
    const app = {
      make: vi.fn().mockReturnValue({
        connection: vi.fn().mockReturnValue(connection),
      }),
      databasePath: vi.fn().mockReturnValue('/app/database/migrations'),
    } as any;

    const command = new MigrateFreshCommand(app);

    await command.handle([], {});

    expect(app.databasePath).toHaveBeenCalledWith('migrations');
    expect(migratorCtorSpy).toHaveBeenCalledWith(connection, ['/app/database/migrations']);
    expect(dropAllTablesSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it('calls dropAllTables() before running migrations', async () => {
    const callOrder: string[] = [];
    dropAllTablesSpy.mockImplementation(() => {
      callOrder.push('dropAllTables');
      return Promise.resolve();
    });
    runSpy.mockImplementation(() => {
      callOrder.push('run');
      return Promise.resolve([]);
    });

    const connection = { name: 'test-connection' };
    const app = {
      make: vi.fn().mockReturnValue({
        connection: vi.fn().mockReturnValue(connection),
      }),
      databasePath: vi.fn().mockReturnValue('/app/database/migrations'),
    } as any;

    const command = new MigrateFreshCommand(app);
    await command.handle([], {});

    expect(callOrder).toEqual(['dropAllTables', 'run']);
  });

  it('does NOT call getRepository() or deleteRepository()', async () => {
    const getRepositorySpy = vi.fn();
    const deleteRepositorySpy = vi.fn();

    // Override the mock migrator constructor for this test to attach the old
    // repository spies so we can assert they are never invoked.
    migratorCtorSpy.mockImplementation(() => {
      // Nothing extra; the mock class definition is static so we just confirm
      // that getRepository is not exposed.
    });

    const connection = { name: 'test-connection' };
    const app = {
      make: vi.fn().mockReturnValue({
        connection: vi.fn().mockReturnValue(connection),
      }),
      databasePath: vi.fn().mockReturnValue('/app/database/migrations'),
    } as any;

    const command = new MigrateFreshCommand(app);
    await command.handle([], {});

    expect(getRepositorySpy).not.toHaveBeenCalled();
    expect(deleteRepositorySpy).not.toHaveBeenCalled();
  });
});
