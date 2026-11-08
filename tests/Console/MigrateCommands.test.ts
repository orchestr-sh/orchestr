import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MigrateCommand } from '@/Console/Commands/MigrateCommand';
import { MigrateInstallCommand } from '@/Console/Commands/MigrateInstallCommand';
import { MigrateRefreshCommand } from '@/Console/Commands/MigrateRefreshCommand';
import { MigrateResetCommand } from '@/Console/Commands/MigrateResetCommand';
import { MigrateRollbackCommand } from '@/Console/Commands/MigrateRollbackCommand';
import { MigrateStatusCommand } from '@/Console/Commands/MigrateStatusCommand';

const migratorCtorSpy = vi.fn();
const runSpy = vi.fn();
const createRepositorySpy = vi.fn();
const refreshSpy = vi.fn();
const resetSpy = vi.fn();
const rollbackSpy = vi.fn();
const getRanSpy = vi.fn();
const getMigrationBatchesSpy = vi.fn();
const getMigrationFilesSpy = vi.fn();
const seederCtorSpy = vi.fn();
const seederRunSpy = vi.fn();

vi.mock('@/Database/Migrations/Migrator', () => {
  class MockMigrator {
    constructor(connection: unknown, paths: string[]) {
      migratorCtorSpy(connection, paths);
    }

    run(options?: unknown) {
      return runSpy(options);
    }

    createRepository() {
      return createRepositorySpy();
    }

    refresh(options?: unknown) {
      return refreshSpy(options);
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

vi.mock('@/Database/Seeders/SeederRunner', () => {
  class MockSeederRunner {
    constructor(connection: unknown, paths: string[]) {
      seederCtorSpy(connection, paths);
    }

    run() {
      return seederRunSpy();
    }
  }

  return { SeederRunner: MockSeederRunner };
});

const createApp = (connection: unknown, defaultMigrationPath = '/default/migrations', environment = 'testing') => ({
  make: vi.fn().mockReturnValue({
    connection: vi.fn().mockReturnValue(connection),
  }),
  databasePath: vi.fn().mockReturnValue(defaultMigrationPath),
  environment: vi.fn().mockReturnValue(environment),
});

describe('Migration console commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    runSpy.mockResolvedValue([]);
    createRepositorySpy.mockResolvedValue(undefined);
    refreshSpy.mockResolvedValue({ rolledBack: [], ran: [] });
    resetSpy.mockResolvedValue([]);
    rollbackSpy.mockResolvedValue([]);
    getRanSpy.mockResolvedValue([]);
    getMigrationBatchesSpy.mockResolvedValue({});
    getMigrationFilesSpy.mockResolvedValue([]);
    seederRunSpy.mockResolvedValue(undefined);

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
    expect(runSpy).toHaveBeenCalledWith({ pretend: true, step: false });
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

  it('MigrateCommand forwards the parsed --step flag so each migration gets its own batch', async () => {
    const app = createApp({ id: 'conn' }) as any;

    await new MigrateCommand(app).handle([], { step: true });

    expect(runSpy).toHaveBeenCalledWith({ pretend: false, step: true });
  });

  it('MigrateCommand treats --step=0 as not stepping', async () => {
    const app = createApp({ id: 'conn' }) as any;

    await new MigrateCommand(app).handle([], { step: '0' });

    expect(runSpy.mock.calls[0][0].step).toBe(false);
  });

  it('MigrateCommand refuses to run in production without --force', async () => {
    const app = createApp({ id: 'conn' }, '/migrations', 'production') as any;

    await expect(new MigrateCommand(app).handle([], {})).rejects.toThrow(/--force/);

    expect(runSpy).not.toHaveBeenCalled();
  });

  it('MigrateCommand runs in production when --force is given', async () => {
    const app = createApp({ id: 'conn' }, '/migrations', 'production') as any;

    runSpy.mockResolvedValue(['001_create_users']);

    await new MigrateCommand(app).handle([], { force: true });

    expect(runSpy).toHaveBeenCalledWith({ pretend: false, step: false });
  });

  it('MigrateCommand seeds after migrating when --seed is given', async () => {
    const connection = { id: 'conn' };
    const app = createApp(connection) as any;

    runSpy.mockResolvedValue(['001_create_users']);

    await new MigrateCommand(app).handle([], { seed: true });

    expect(seederCtorSpy).toHaveBeenCalledWith(connection, ['./database/seeders']);
    expect(seederRunSpy).toHaveBeenCalledTimes(1);
  });

  it('MigrateCommand seeds even when there was nothing to migrate', async () => {
    const app = createApp({ id: 'conn' }) as any;

    await new MigrateCommand(app).handle([], { seed: true });

    expect(seederRunSpy).toHaveBeenCalledTimes(1);
  });

  it('MigrateCommand honours --seeders-path', async () => {
    const connection = { id: 'conn' };
    const app = createApp(connection) as any;

    runSpy.mockResolvedValue(['001_create_users']);

    await new MigrateCommand(app).handle([], { seed: true, 'seeders-path': '/pkg/seeders' });

    expect(seederCtorSpy).toHaveBeenCalledWith(connection, ['/pkg/seeders']);
  });

  it('MigrateCommand does not seed unless asked', async () => {
    const app = createApp({ id: 'conn' }) as any;

    runSpy.mockResolvedValue(['001_create_users']);

    await new MigrateCommand(app).handle([], {});

    expect(seederCtorSpy).not.toHaveBeenCalled();
  });

  it('MigrateInstallCommand creates the migration repository', async () => {
    const connection = { id: 'conn' };
    const app = createApp(connection, '/app/database/migrations') as any;

    await new MigrateInstallCommand(app).handle([], {});

    expect(migratorCtorSpy).toHaveBeenCalledWith(connection, ['/app/database/migrations']);
    expect(createRepositorySpy).toHaveBeenCalledTimes(1);
  });

  it('MigrateRefreshCommand passes array paths through as-is', async () => {
    const connection = { id: 'conn' };
    const app = createApp(connection) as any;

    const command = new MigrateRefreshCommand(app);

    await command.handle([], { path: ['/pkg-a/migrations', '/pkg-b/migrations'] });

    expect(migratorCtorSpy).toHaveBeenCalledWith(connection, ['/pkg-a/migrations', '/pkg-b/migrations']);
    expect(refreshSpy).toHaveBeenCalledWith({ step: undefined, pretend: false });
    expect(app.databasePath).not.toHaveBeenCalled();
  });

  it('MigrateRefreshCommand parses --step and --pretend', async () => {
    const app = createApp({ id: 'conn' }) as any;

    await new MigrateRefreshCommand(app).handle([], { step: '5', pretend: true });

    expect(refreshSpy).toHaveBeenCalledWith({ step: 5, pretend: true });
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
