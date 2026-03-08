import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MigrateCommand } from '@/Console/Commands/MigrateCommand';
import { MigrateRefreshCommand } from '@/Console/Commands/MigrateRefreshCommand';
import { MigrateResetCommand } from '@/Console/Commands/MigrateResetCommand';
import { MigrateRollbackCommand } from '@/Console/Commands/MigrateRollbackCommand';
import { MigrateStatusCommand } from '@/Console/Commands/MigrateStatusCommand';

const migratorCtorSpy = vi.fn();
const runSpy = vi.fn();
const refreshSpy = vi.fn();
const resetSpy = vi.fn();
const rollbackSpy = vi.fn();
const getRanSpy = vi.fn();
const getMigrationBatchesSpy = vi.fn();
const getMigrationFilesSpy = vi.fn();

vi.mock('@/Database/Migrations/Migrator', () => {
  class MockMigrator {
    constructor(connection: unknown, paths: string[]) {
      migratorCtorSpy(connection, paths);
    }

    run(options?: unknown) {
      return runSpy(options);
    }

    refresh() {
      return refreshSpy();
    }

    reset() {
      return resetSpy();
    }

    rollback(options?: unknown) {
      return rollbackSpy(options);
    }

    getRan() {
      return getRanSpy();
    }

    getMigrationBatches() {
      return getMigrationBatchesSpy();
    }

    getMigrationFiles() {
      return getMigrationFilesSpy();
    }
  }

  return { Migrator: MockMigrator };
});

const createApp = (connection: unknown, defaultMigrationPath = '/default/migrations') => ({
  make: vi.fn().mockReturnValue({
    connection: vi.fn().mockReturnValue(connection),
  }),
  databasePath: vi.fn().mockReturnValue(defaultMigrationPath),
});

describe('Migration console commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    runSpy.mockResolvedValue([]);
    refreshSpy.mockResolvedValue({ rolledBack: [], ran: [] });
    resetSpy.mockResolvedValue([]);
    rollbackSpy.mockResolvedValue([]);
    getRanSpy.mockResolvedValue([]);
    getMigrationBatchesSpy.mockResolvedValue({});
    getMigrationFilesSpy.mockResolvedValue([]);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('MigrateCommand wraps a string path into an array and forwards pretend=true', async () => {
    const connection = { id: 'conn' };
    const app = createApp(connection) as any;

    const command = new MigrateCommand(app);

    await command.handle([], { path: '/custom/migrations', pretend: true });

    expect(migratorCtorSpy).toHaveBeenCalledWith(connection, ['/custom/migrations']);
    expect(runSpy).toHaveBeenCalledWith({ pretend: true });
    expect(app.databasePath).not.toHaveBeenCalled();
  });

  it('MigrateCommand falls back to app.databasePath when path option is missing', async () => {
    const connection = { id: 'conn' };
    const app = createApp(connection, '/app/database/migrations') as any;

    const command = new MigrateCommand(app);

    await command.handle([], {});

    expect(app.databasePath).toHaveBeenCalledWith('migrations');
    expect(migratorCtorSpy).toHaveBeenCalledWith(connection, ['/app/database/migrations']);
  });

  it('MigrateRefreshCommand passes array paths through as-is', async () => {
    const connection = { id: 'conn' };
    const app = createApp(connection) as any;

    const command = new MigrateRefreshCommand(app);

    await command.handle([], { path: ['/pkg-a/migrations', '/pkg-b/migrations'] });

    expect(migratorCtorSpy).toHaveBeenCalledWith(connection, ['/pkg-a/migrations', '/pkg-b/migrations']);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(app.databasePath).not.toHaveBeenCalled();
  });

  it('MigrateResetCommand falls back to app.databasePath when path option is missing', async () => {
    const connection = { id: 'conn' };
    const app = createApp(connection, '/app/database/migrations') as any;

    const command = new MigrateResetCommand(app);

    await command.handle([], {});

    expect(app.databasePath).toHaveBeenCalledWith('migrations');
    expect(migratorCtorSpy).toHaveBeenCalledWith(connection, ['/app/database/migrations']);
    expect(resetSpy).toHaveBeenCalledTimes(1);
  });

  it('MigrateRollbackCommand normalizes string path and parses step', async () => {
    const connection = { id: 'conn' };
    const app = createApp(connection) as any;

    const command = new MigrateRollbackCommand(app);

    await command.handle([], { path: '/tenant/migrations', step: '2', pretend: true });

    expect(migratorCtorSpy).toHaveBeenCalledWith(connection, ['/tenant/migrations']);
    expect(rollbackSpy).toHaveBeenCalledWith({ step: 2, pretend: true });
  });

  it('MigrateStatusCommand falls back to app.databasePath when path option is missing', async () => {
    const connection = { id: 'conn' };
    const app = createApp(connection, '/app/database/migrations') as any;

    const command = new MigrateStatusCommand(app);

    await command.handle([], {});

    expect(app.databasePath).toHaveBeenCalledWith('migrations');
    expect(migratorCtorSpy).toHaveBeenCalledWith(connection, ['/app/database/migrations']);
    expect(getRanSpy).toHaveBeenCalledTimes(1);
    expect(getMigrationBatchesSpy).toHaveBeenCalledTimes(1);
    expect(getMigrationFilesSpy).toHaveBeenCalledTimes(1);
  });
});
