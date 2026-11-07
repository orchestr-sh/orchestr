import { describe, it, expect, vi } from 'vitest';
import type { DatabaseAdapter } from '@/Database/Contracts/DatabaseAdapter';
import type { QueryGrammar } from '@/Database/Query/Grammars';
import { Builder } from '@/Database/Query/Builder';
import { MySqlGrammar, SqliteGrammar } from '@/Database/Query/Grammars';

function makeAdapter(overrides: Partial<DatabaseAdapter> = {}): DatabaseAdapter {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    query: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    transaction: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    getDriver: vi.fn(),
    getTableInfo: vi.fn(),
    getTables: vi.fn(),
    ...overrides,
  } as unknown as DatabaseAdapter;
}

function builder(grammar: QueryGrammar, overrides: Partial<DatabaseAdapter> = {}): Builder {
  return new Builder(makeAdapter(overrides), grammar).from('projects');
}

describe('Query Builder returning()', () => {
  it('returns selected columns for single insert on RETURNING-capable grammar', async () => {
    const rows = [{ id: 1, created_at: '2026-03-10T00:00:00.000Z' }];
    const select = vi.fn().mockResolvedValue(rows);
    const qb = builder(new SqliteGrammar(), { select });
    const result = await qb.insertReturning({ name: 'Alpha' }, ['id', 'created_at']);
    expect(result).toEqual(rows[0]);
    expect(select).toHaveBeenCalledTimes(1);
    const sql = (select.mock.calls[0][0] as string) || '';
    expect(sql).toContain('INSERT INTO "projects" ("name")');
    expect(sql).toContain('RETURNING "id", "created_at"');
  });

  it('returns array of rows for bulk insert on RETURNING-capable grammar', async () => {
    const rows = [
      { id: 1, created_at: '2026-03-10T00:00:00.000Z' },
      { id: 2, created_at: '2026-03-10T00:00:00.000Z' },
    ];
    const select = vi.fn().mockResolvedValue(rows);
    const qb = builder(new SqliteGrammar(), { select });
    const result = await qb.insertReturning([{ name: 'Alpha' }, { name: 'Beta' }], ['id', 'created_at']);
    expect(result).toEqual(rows);
    expect(select).toHaveBeenCalledTimes(1);
    const sql = (select.mock.calls[0][0] as string) || '';
    expect(sql).toContain('VALUES (?), (?)');
    expect(sql).toContain('RETURNING "id", "created_at"');
  });

  it('uses returning() setter when columns not provided', async () => {
    const rows = [{ id: 10 }];
    const select = vi.fn().mockResolvedValue(rows);
    const qb = builder(new SqliteGrammar(), { select }).returning('id');
    const result = await qb.insertReturning({ name: 'Gamma' });
    expect(result).toEqual(rows[0]);
    const sql = (select.mock.calls[0][0] as string) || '';
    expect(sql).toContain('RETURNING "id"');
  });

  it('reads the generated key back from the configured returning column, not a hard-coded id', async () => {
    const rows = [{ uuid: 'a1b2c3' }];
    const select = vi.fn().mockResolvedValue(rows);
    const qb = builder(new SqliteGrammar(), { select });
    const result = await qb.insertReturning({ name: 'Delta' }, 'uuid');
    expect(result).toEqual(rows[0]);
    const sql = (select.mock.calls[0][0] as string) || '';
    expect(sql).toContain('RETURNING "uuid"');
    expect(sql).not.toContain('"id"');
  });

  it('chains insert(...).returning(...) for single insert', async () => {
    const rows = [{ id: 7, created_at: '2026-03-10T00:00:00.000Z' }];
    const select = vi.fn().mockResolvedValue(rows);
    const qb = builder(new SqliteGrammar(), { select });
    const result = await qb.insert({ name: 'Delta' }).returning(['id', 'created_at']);
    expect(result).toEqual(rows[0]);
    const sql = (select.mock.calls[0][0] as string) || '';
    expect(sql).toContain('INSERT INTO "projects" ("name")');
    expect(sql).toContain('RETURNING "id", "created_at"');
  });

  it('awaits insert(...) without returning and executes plain insert', async () => {
    const insert = vi.fn().mockResolvedValue(1);
    const qb = builder(new SqliteGrammar(), { insert });
    const ok = await qb.insert({ name: 'Echo' });
    expect(ok).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    const sql = (insert.mock.calls[0][0] as string) || '';
    expect(sql).toContain('INSERT INTO "projects" ("name")');
    expect(sql).not.toContain('RETURNING');
  });

  it('inserts then re-reads the row by the configured key on a grammar without RETURNING', async () => {
    const select = vi.fn().mockResolvedValue([{ id: 42, name: 'Alpha' }]);
    const insert = vi.fn().mockResolvedValue(42);
    const qb = builder(new MySqlGrammar(), { select, insert });
    const result = await qb.insertReturning({ name: 'Alpha' }, ['id', 'name'], 'id');
    expect(result).toEqual({ id: 42, name: 'Alpha' });
    expect(insert).toHaveBeenCalledTimes(1);
    const selectSql = (select.mock.calls[0][0] as string) || '';
    const selectBindings = select.mock.calls[0][1] as any[] | undefined;
    expect(selectSql).toContain('SELECT `id`, `name` FROM `projects` WHERE `id` = ?');
    expect(selectSql).toContain('LIMIT 1');
    expect(selectBindings?.[0]).toBe(42);
  });

  it('does not assume an id column when no key is configured for a grammar without RETURNING', async () => {
    const insert = vi.fn().mockResolvedValue(42);
    const qb = builder(new MySqlGrammar(), { insert });
    await expect(qb.insertReturning({ name: 'Alpha' }, ['uuid'])).rejects.toThrow(/no key column was configured/);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('falls back to the key lookup when a SQLite build rejects the RETURNING clause', async () => {
    const select = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('RETURNING')) {
        throw new Error('not supported');
      }
      return Promise.resolve([{ id: 42, name: 'Alpha' }]);
    });
    const insert = vi.fn().mockResolvedValue(42);
    const qb = builder(new SqliteGrammar(), { select, insert });
    const result = await qb.insertReturning({ name: 'Alpha' }, ['id', 'name'], 'id');
    expect(result).toEqual({ id: 42, name: 'Alpha' });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('throws for bulk insert when the grammar has no RETURNING support', async () => {
    const select = vi.fn().mockResolvedValue([]);
    const insert = vi.fn().mockResolvedValue(1);
    const qb = builder(new MySqlGrammar(), { select, insert });
    await expect(qb.insertReturning([{ name: 'Alpha' }, { name: 'Beta' }], ['id'])).rejects.toThrow(
      'not supported for bulk inserts'
    );
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
