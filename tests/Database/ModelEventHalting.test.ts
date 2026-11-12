/**
 * Model event halting through the async dispatcher
 *
 * `Ensemble.fireModelEvent()` awaits `until()`, so listeners that resolve
 * `false` - after real async work - must halt the lifecycle operation for
 * every halting event (creating, updating, saving, deleting, restoring,
 * forceDeleting). Non-halting events still wait for async listeners to
 * finish before the promise chain continues.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { Dispatcher } from '@/Events/Dispatcher';
import { Application } from '@/Foundation/Application';
import { Facade } from '@/Support/Facade';
import { recordAdapter, type ExecutedQuery } from './Query/support';

function useRecorder(results: Record<string, any> = {}): ExecutedQuery[] {
  const { adapter, queries } = recordAdapter(results);

  const manager = new DatabaseManager({
    default: 'test',
    connections: {
      test: { adapter: 'recording', driver: 'sqlite', database: ':memory:' },
    },
  });
  manager.registerAdapter('recording', () => adapter);
  Ensemble.setConnectionResolver(manager);

  return queries;
}

class User extends Ensemble {
  static fillable: string[] = ['name'];
  protected timestamps: boolean = false;

  getTable(): string {
    return 'users';
  }
}

class SoftUser extends Ensemble {
  static softDeletes = true;
  static fillable: string[] = ['name'];
  protected timestamps: boolean = false;

  getTable(): string {
    return 'soft_users';
  }
}

function persistedTrashedUser(id: number = 1): SoftUser {
  const user = new SoftUser({ id, name: 'Ada', deleted_at: new Date('2026-01-01T00:00:00.000Z') }, true);
  user.exists = true;
  return user;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('Ensemble model events with the async dispatcher', () => {
  let queries: ExecutedQuery[];
  let app: Application;
  let dispatcher: Dispatcher;

  beforeEach(() => {
    queries = useRecorder({ insert: 7 });
    app = new Application('/test');
    dispatcher = new Dispatcher(app);
    app.instance('events', dispatcher);
    Facade.setFacadeApplication(app);
  });

  afterEach(() => {
    Facade.setFacadeApplication(undefined as any);
    vi.restoreAllMocks();
  });

  it('halts create when an async listener resolves false for creating', async () => {
    dispatcher.listen('ModelCreating', async () => {
      await tick();
      return false;
    });

    const saved = await new User({ name: 'Blocked' }).save();

    expect(saved).toBe(false);
    expect(queries.filter((query) => query.method === 'insert')).toHaveLength(0);
  });

  it('halts save when an async listener resolves false for saving', async () => {
    dispatcher.listen('ModelSaving', async () => {
      await tick();
      return false;
    });

    const saved = await new User({ name: 'Blocked' }).save();

    expect(saved).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('halts updates when an async listener resolves false for updating', async () => {
    const user = await User.create({ name: 'Ada' });
    queries = [];

    dispatcher.listen('ModelUpdating', async () => {
      await tick();
      return false;
    });

    user.setAttribute('name', 'Grace');
    const saved = await user.save();

    expect(saved).toBe(false);
    expect(queries.filter((query) => query.method === 'update')).toHaveLength(0);
  });

  it('halts deletes when an async listener resolves false for deleting', async () => {
    const user = await User.create({ name: 'Ada' });
    queries = [];

    dispatcher.listen('ModelDeleting', async () => {
      await tick();
      return false;
    });

    const deleted = await user.delete();

    expect(deleted).toBe(false);
    expect(user.exists).toBe(true);
    expect(queries.filter((query) => query.method === 'delete')).toHaveLength(0);
  });

  it('halts restore when an async listener resolves false for restoring', async () => {
    const user = persistedTrashedUser();
    queries = [];

    dispatcher.listen('ModelRestoring', async () => {
      await tick();
      return false;
    });

    await expect(user.restore()).resolves.toBe(false);
    expect(queries.filter((query) => query.method === 'update')).toHaveLength(0);
  });

  it('halts force delete when an async listener resolves false for forceDeleting', async () => {
    const user = persistedTrashedUser();
    queries = [];

    dispatcher.listen('ModelForceDeleting', async () => {
      await tick();
      return false;
    });

    await expect(user.forceDelete()).resolves.toBe(false);
    expect(queries.filter((query) => query.method === 'delete')).toHaveLength(0);
  });

  it('supports class instance listeners that veto asynchronously', async () => {
    class VetoListener {
      async handle(): Promise<boolean> {
        await tick();
        return false;
      }
    }

    dispatcher.listen('ModelCreating', new VetoListener());

    const saved = await new User({ name: 'Vetoed' }).save();

    expect(saved).toBe(false);
  });

  it('awaits non-halting async listeners before the lifecycle continues', async () => {
    let completed = false;

    dispatcher.listen('ModelCreated', async () => {
      await tick();
      completed = true;
    });

    await User.create({ name: 'Ada' });

    expect(completed).toBe(true);
  });

  it('keeps a successful create when listeners return nothing', async () => {
    const created = vi.fn(async () => {
      await tick();
      return undefined;
    });
    dispatcher.listen('ModelCreating', created);

    const user = await User.create({ name: 'Ada' });

    expect(user.exists).toBe(true);
    expect(created).toHaveBeenCalledTimes(1);
  });
});
