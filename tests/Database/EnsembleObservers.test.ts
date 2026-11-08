/**
 * Ensemble observer tests
 *
 * Observers register lifecycle hooks per model class and fire through the
 * same `fireModelEvent` path as the global dispatcher. Halting hooks return
 * `false` to abort the operation; the dispatcher contract must keep working
 * alongside them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { ModelSaved } from '@/Database/Ensemble/Events';
import { ObservedBy } from '@/Database/Ensemble/Observers/ObservedBy';
import { Dispatcher } from '@/Events/Dispatcher';
import { Application } from '@/Foundation/Application';
import { Facade } from '@/Support/Facade';
import { recordAdapter, type ExecutedQuery } from './Query/support';

// ---------------------------------------------------------------------------
// Recording helpers
// ---------------------------------------------------------------------------

/**
 * Point every Ensemble at a fresh recording adapter and hand back the queries
 * that get executed. `results` seeds what the fake driver returns per method.
 */
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

// ---------------------------------------------------------------------------
// Test models
// ---------------------------------------------------------------------------

class User extends Ensemble {
  static fillable: string[] = ['name'];
  protected timestamps: boolean = false;

  getTable(): string {
    return 'users';
  }
}

class OrderObserver {
  static calls: string[] = [];

  saving(): void {
    OrderObserver.calls.push('saving');
  }

  created(): void {
    OrderObserver.calls.push('created');
  }

  creating(): void {
    OrderObserver.calls.push('creating');
  }

  saved(): void {
    OrderObserver.calls.push('saved');
  }

  updating(): void {
    OrderObserver.calls.push('updating');
  }

  updated(): void {
    OrderObserver.calls.push('updated');
  }

  deleting(): void {
    OrderObserver.calls.push('deleting');
  }

  deleted(): void {
    OrderObserver.calls.push('deleted');
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Ensemble observers', () => {
  let queries: ExecutedQuery[];

  beforeEach(() => {
    OrderObserver.calls = [];
    queries = useRecorder({ insert: 7 });
    User.forgetObservers();
    User.observe(OrderObserver);
  });

  it('calls creating/created/saving/saved hooks in lifecycle order on create', async () => {
    const user = await User.create({ name: 'Ada' });

    expect(user.exists).toBe(true);
    expect(OrderObserver.calls).toEqual(['saving', 'creating', 'created', 'saved']);
  });

  it('calls updating/updated hooks on save of an existing model', async () => {
    const user = await User.create({ name: 'Ada' });
    OrderObserver.calls = [];

    user.setAttribute('name', 'Grace');
    await user.save();

    expect(OrderObserver.calls).toEqual(['saving', 'updating', 'updated', 'saved']);
    expect(queries.map((query) => query.method)).toEqual(['insert', 'update']);
  });

  it('calls deleting/deleted hooks in order on delete', async () => {
    const user = await User.create({ name: 'Ada' });
    OrderObserver.calls = [];

    const deleted = await user.delete();

    expect(deleted).toBe(true);
    expect(OrderObserver.calls).toEqual(['deleting', 'deleted']);
    expect(queries[1].method).toBe('delete');
  });

  it('receives the model instance in every hook', async () => {
    const seen: Ensemble[] = [];
    User.forgetObservers();
    User.observe({
      creating: (model: Ensemble) => {
        seen.push(model);
      },
      saved: (model: Ensemble) => {
        seen.push(model);
      },
    });

    const user = await User.create({ name: 'Ada' });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(user);
    expect(user.getAttribute('name')).toBe('Ada');
  });

  it('halts the insert when creating returns false', async () => {
    User.forgetObservers();
    User.observe({
      creating: () => false,
      created: () => {
        throw new Error('created must not fire after a halted creating');
      },
    });

    const user = new User({ name: 'Blocked' });
    const saved = await user.save();

    expect(saved).toBe(false);
    expect(user.exists).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('halts the delete when deleting returns false', async () => {
    const user = await User.create({ name: 'Ada' });
    queries = [];

    User.forgetObservers();
    User.observe({
      deleting: () => false,
    });

    const deleted = await user.delete();

    expect(deleted).toBe(false);
    expect(user.exists).toBe(true);
    expect(queries).toHaveLength(0);
  });

  it('ignores false returned from non-halting hooks', async () => {
    User.forgetObservers();
    User.observe({
      created: () => false,
    });

    const user = await User.create({ name: 'Ada' });

    expect(user.exists).toBe(true);
    expect(queries[0].method).toBe('insert');
  });

  it('supports halting from an async creating hook', async () => {
    User.forgetObservers();
    User.observe({
      creating: async () => {
        await Promise.resolve();
        return false;
      },
    });

    const saved = await new User({ name: 'Slow' }).save();

    expect(saved).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it('runs only the hooks the observer implements', async () => {
    const creating = vi.fn();

    User.forgetObservers();
    User.observe({ creating });

    await User.create({ name: 'Ada' });

    expect(creating).toHaveBeenCalledTimes(1);
  });

  it('fires observers registered on a parent class for subclasses', async () => {
    class BaseRecord extends Ensemble {
      static fillable: string[] = ['name'];
      protected timestamps: boolean = false;

      getTable(): string {
        return 'records';
      }
    }

    class DerivedRecord extends BaseRecord {
      getTable(): string {
        return 'derived_records';
      }
    }

    const calls: string[] = [];
    BaseRecord.forgetObservers();
    BaseRecord.observe({ creating: () => calls.push('creating') });

    const record = new DerivedRecord();
    record.setAttribute('name', 'child');
    await record.save();

    expect(calls).toEqual(['creating']);
  });

  it('registers observers through the @ObservedBy decorator', async () => {
    const created = vi.fn();

    class AuditObserver {
      created(model: Ensemble): void {
        created(model);
      }
    }

    @ObservedBy(AuditObserver)
    class DecoratedUser extends Ensemble {
      static fillable: string[] = ['name'];
      protected timestamps: boolean = false;

      getTable(): string {
        return 'decorated_users';
      }
    }

    const user = await DecoratedUser.create({ name: 'Ada' });

    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0][0]).toBe(user);
  });

  it('accepts multiple observers via @ObservedBy and keeps them in order', async () => {
    const calls: string[] = [];

    class FirstObserver {
      creating(): void {
        calls.push('first');
      }
    }

    class SecondObserver {
      creating(): void {
        calls.push('second');
      }
    }

    @ObservedBy(FirstObserver, SecondObserver)
    class MultiUser extends Ensemble {
      static fillable: string[] = ['name'];
      protected timestamps: boolean = false;

      getTable(): string {
        return 'multi_users';
      }
    }

    await MultiUser.create({ name: 'Ada' });

    expect(calls).toEqual(['first', 'second']);
  });

  // -------------------------------------------------------------------------
  // The global event dispatcher keeps working unchanged
  // -------------------------------------------------------------------------
  describe('alongside the event dispatcher', () => {
    let app: Application;
    let dispatcher: Dispatcher;

    beforeEach(() => {
      app = new Application('/test');
      dispatcher = new Dispatcher(app);
      app.instance('events', dispatcher);
      Facade.setFacadeApplication(app);
    });

    afterEach(() => {
      Facade.setFacadeApplication(undefined as any);
    });

    it('still dispatches non-halting events to listeners', async () => {
      const saved = vi.fn();
      dispatcher.listen(ModelSaved.name, saved);

      const user = await User.create({ name: 'Ada' });

      expect(saved).toHaveBeenCalledTimes(1);
      expect(saved.mock.calls[0][0].model).toBe(user);
      // Observers and listeners both ran.
      expect(OrderObserver.calls).toEqual(['saving', 'creating', 'created', 'saved']);
    });

    it('still halts the save when a dispatcher listener returns false', async () => {
      const observerCreating = vi.fn();
      User.forgetObservers();
      User.observe({ creating: observerCreating });

      dispatcher.listen('ModelCreating', () => false);

      const saved = await new User({ name: 'Blocked' }).save();

      expect(saved).toBe(false);
      expect(observerCreating).toHaveBeenCalledTimes(1);
      expect(queries.filter((query) => query.method === 'insert')).toHaveLength(0);
    });
  });
});
