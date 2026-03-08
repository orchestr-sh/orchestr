import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MakeMigrationCommand } from '@/Console/Commands/MakeMigrationCommand';

const createSpy = vi.fn();

vi.mock('@/Database/Migrations/MigrationCreator', () => {
  class MockMigrationCreator {
    create(name: string, migrationPath: string, table?: string, create?: boolean) {
      return createSpy(name, migrationPath, table, create);
    }
  }

  return { MigrationCreator: MockMigrationCreator };
});

describe('MakeMigrationCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSpy.mockResolvedValue('/tmp/migrations/2026_01_01_000000_create_users_table.ts');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('uses --path when provided', async () => {
    const app = {
      databasePath: vi.fn().mockReturnValue('/app/database/migrations'),
    } as any;

    const command = new MakeMigrationCommand(app);

    await command.handle(['create_users_table'], {
      path: '/custom/migrations',
      table: 'users',
      create: true,
    });

    expect(createSpy).toHaveBeenCalledWith('create_users_table', '/custom/migrations', 'users', true);
    expect(app.databasePath).not.toHaveBeenCalled();
  });

  it('falls back to app.databasePath when --path is missing', async () => {
    const app = {
      databasePath: vi.fn().mockReturnValue('/app/database/migrations'),
    } as any;

    const command = new MakeMigrationCommand(app);

    await command.handle(['create_posts_table'], {});

    expect(app.databasePath).toHaveBeenCalledWith('migrations');
    expect(createSpy).toHaveBeenCalledWith('create_posts_table', '/app/database/migrations', undefined, false);
  });

  it('does not attempt creation when migration name is missing', async () => {
    const app = {
      databasePath: vi.fn(),
    } as any;

    const command = new MakeMigrationCommand(app);

    await command.handle([], {});

    expect(createSpy).not.toHaveBeenCalled();
    expect(app.databasePath).not.toHaveBeenCalled();
  });
});
