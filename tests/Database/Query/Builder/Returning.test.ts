import { describe, it, expect, vi } from 'vitest';
import { Builder } from '@/Database/Query/Builder';
import type { DatabaseAdapter } from '@/Database/Contracts/DatabaseAdapter';

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

describe('Query Builder returning()', () => {
  it('returns selected columns for single insert on RETURNING-capable adapter', async () => {
    const rows = [{ id: 1, created_at: '2026-03-10T00:00:00.000Z' }];
    const select = vi.fn().mockResolvedValue(rows);
    const adapter = makeAdapter({ select });
    const qb = new Builder(adapter).from('projects');
    const result = await qb.insertReturning({ name: 'Alpha' }, ['id', 'created_at']);
    expect(result).toEqual(rows[0]);
    expect(select).toHaveBeenCalledTimes(1);
    const sql = (select.mock.calls[0][0] as string) || '';
    expect(sql).toContain('INSERT INTO projects');
    expect(sql).toContain('RETURNING id, created_at');
  });

  it('returns array of rows for bulk insert on RETURNING-capable adapter', async () => {
    const rows = [
      { id: 1, created_at: '2026-03-10T00:00:00.000Z' },
      { id: 2, created_at: '2026-03-10T00:00:00.000Z' },
    ];
    const select = vi.fn().mockResolvedValue(rows);
    const adapter = makeAdapter({ select });
    const qb = new Builder(adapter).from('projects');
    const result = await qb.insertReturning([{ name: 'Alpha' }, { name: 'Beta' }], ['id', 'created_at']);
    expect(result).toEqual(rows);
    expect(select).toHaveBeenCalledTimes(1);
    const sql = (select.mock.calls[0][0] as string) || '';
    expect(sql).toContain('VALUES (?), (?)');
    expect(sql).toContain('RETURNING id, created_at');
  });

  it('uses returning() setter when columns not provided', async () => {
    const rows = [{ id: 10 }];
    const select = vi.fn().mockResolvedValue(rows);
    const adapter = makeAdapter({ select });
    const qb = new Builder(adapter).from('projects').returning('id');
    const result = await qb.insertReturning({ name: 'Gamma' });
    expect(result).toEqual(rows[0]);
    const sql = (select.mock.calls[0][0] as string) || '';
    expect(sql).toContain('RETURNING id');
  });

  it('chains insert(...).returning(...) for single insert', async () => {
    const rows = [{ id: 7, created_at: '2026-03-10T00:00:00.000Z' }];
    const select = vi.fn().mockResolvedValue(rows);
    const adapter = makeAdapter({ select });
    const qb = new Builder(adapter).from('projects');
    const result = await qb.insert({ name: 'Delta' }).returning(['id', 'created_at']);
    expect(result).toEqual(rows[0]);
    const sql = (select.mock.calls[0][0] as string) || '';
    expect(sql).toContain('INSERT INTO projects');
    expect(sql).toContain('RETURNING id, created_at');
  });

  it('awaits insert(...) without returning and executes plain insert', async () => {
    const insert = vi.fn().mockResolvedValue(1);
    const adapter = makeAdapter({ insert });
    const qb = new Builder(adapter).from('projects');
    const ok = await qb.insert({ name: 'Echo' });
    expect(ok).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
    const sql = (insert.mock.calls[0][0] as string) || '';
    expect(sql).toContain('INSERT INTO projects');
    expect(sql).not.toContain('RETURNING');
  });

  it('falls back on non-RETURNING adapter for single insert', async () => {
    const select = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('RETURNING')) {
        throw new Error('not supported');
      }
      return Promise.resolve([{ id: 42, name: 'Alpha' }]);
    });
    const insert = vi.fn().mockResolvedValue(42);
    const adapter = makeAdapter({ select, insert });
    const qb = new Builder(adapter).from('projects');
    const result = await qb.insertReturning({ name: 'Alpha' }, ['id', 'name']);
    expect(result).toEqual({ id: 42, name: 'Alpha' });
    expect(insert).toHaveBeenCalledTimes(1);
    const selectSql = (select.mock.calls[1][0] as string) || '';
    const selectBindings = select.mock.calls[1][1] as any[] | undefined;
    expect(selectSql).toContain('SELECT id, name FROM projects WHERE id = ?');
    expect(selectBindings?.[0]).toBe(42);
  });

  it('throws for bulk insert when adapter does not support RETURNING', async () => {
    const select = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('RETURNING')) {
        throw new Error('not supported');
      }
      return Promise.resolve([]);
    });
    const insert = vi.fn().mockResolvedValue(1);
    const adapter = makeAdapter({ select, insert });
    const qb = new Builder(adapter).from('projects');
    await expect(qb.insertReturning([{ name: 'Alpha' }, { name: 'Beta' }], ['id'])).rejects.toThrow(
      'not supported for bulk inserts'
    );
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
