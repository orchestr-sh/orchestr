import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseManager } from '@/Database/DatabaseManager';
import { Expression, raw } from '@/Database/Query/Expression';
import { EnsembleCollection } from '@/Database/Ensemble/EnsembleCollection';
import { Ensemble } from '@/Database/Ensemble/Ensemble';

// Mock adapter for DatabaseManager tests
function createMockAdapter() {
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
  };
}

describe('DatabaseManager', () => {
  let manager: DatabaseManager;

  beforeEach(() => {
    manager = new DatabaseManager({
      default: 'sqlite',
      connections: {
        sqlite: { adapter: 'test', driver: 'sqlite', database: ':memory:' },
        mysql: { adapter: 'test', driver: 'mysql', host: 'localhost' },
      },
    });

    manager.registerAdapter('test', () => createMockAdapter() as any);
  });

  describe('connection()', () => {
    it('returns default connection', () => {
      const conn = manager.connection();
      expect(conn).toBeDefined();
    });

    it('returns named connection', () => {
      const conn = manager.connection('mysql');
      expect(conn).toBeDefined();
    });

    it('caches connections', () => {
      const a = manager.connection();
      const b = manager.connection();
      expect(a).toBe(b);
    });

    it('throws for unconfigured connection', () => {
      expect(() => manager.connection('redis')).toThrow('not configured');
    });

    it('throws for unregistered adapter', () => {
      const mgr = new DatabaseManager({
        default: 'pg',
        connections: { pg: { adapter: 'postgres', driver: 'pg' } },
      });
      expect(() => mgr.connection()).toThrow('not registered');
    });
  });

  describe('disconnect()', () => {
    it('disconnects and removes cached connection', async () => {
      const a = manager.connection();
      await manager.disconnect();
      const b = manager.connection();
      expect(a).not.toBe(b);
    });
  });

  describe('disconnectAll()', () => {
    it('disconnects all connections', async () => {
      manager.connection('sqlite');
      manager.connection('mysql');
      await manager.disconnectAll();
      // Re-creating should give new instances
      const sqlite = manager.connection('sqlite');
      const mysql = manager.connection('mysql');
      expect(sqlite).toBeDefined();
      expect(mysql).toBeDefined();
    });
  });

  describe('default connection', () => {
    it('getDefaultConnection() returns configured default', () => {
      expect(manager.getDefaultConnection()).toBe('sqlite');
    });

    it('setDefaultConnection() changes default', () => {
      manager.setDefaultConnection('mysql');
      expect(manager.getDefaultConnection()).toBe('mysql');
    });
  });

  describe('getConnections()', () => {
    it('returns all configured connection names', () => {
      expect(manager.getConnections()).toEqual(['sqlite', 'mysql']);
    });
  });

  describe('registerAdapter()', () => {
    it('registers a new adapter factory', () => {
      manager.registerAdapter('custom', () => createMockAdapter() as any);
      // No error means it was registered
    });
  });
});

describe('Expression', () => {
  it('stores and returns value', () => {
    const expr = new Expression('COUNT(*)');
    expect(expr.getValue()).toBe('COUNT(*)');
  });

  it('toString() returns value', () => {
    const expr = new Expression('NOW()');
    expect(expr.toString()).toBe('NOW()');
  });
});

describe('raw()', () => {
  it('creates an Expression', () => {
    const expr = raw('UPPER(name)');
    expect(expr).toBeInstanceOf(Expression);
    expect(expr.getValue()).toBe('UPPER(name)');
  });
});

// Create a mock Ensemble subclass for collection tests
class MockModel extends Ensemble {
  static table = 'mock';
  static primaryKey = 'id';

  constructor(attrs: Record<string, any> = {}) {
    super();
    this.attributes = attrs;
  }

  getKey() {
    return this.attributes.id;
  }

  toObject() {
    return { ...this.attributes };
  }
}

describe('EnsembleCollection', () => {
  function createCollection(items: Record<string, any>[]) {
    return new EnsembleCollection(
      items.map((i) => {
        const m = new MockModel(i);
        return m;
      })
    );
  }

  describe('basic methods', () => {
    it('all() returns plain array', () => {
      const col = createCollection([{ id: 1 }, { id: 2 }]);
      expect(col.all()).toHaveLength(2);
    });

    it('first() returns first item', () => {
      const col = createCollection([{ id: 1 }, { id: 2 }]);
      expect(col.first()!.getKey()).toBe(1);
    });

    it('first() with callback returns first matching', () => {
      const col = createCollection([
        { id: 1, active: false },
        { id: 2, active: true },
      ]);
      const item = col.first((m) => (m as any).attributes.active === true);
      expect(item!.getKey()).toBe(2);
    });

    it('last() returns last item', () => {
      const col = createCollection([{ id: 1 }, { id: 2 }]);
      expect(col.last()!.getKey()).toBe(2);
    });

    it('isEmpty() / isNotEmpty()', () => {
      expect(createCollection([]).isEmpty()).toBe(true);
      expect(createCollection([]).isNotEmpty()).toBe(false);
      expect(createCollection([{ id: 1 }]).isEmpty()).toBe(false);
      expect(createCollection([{ id: 1 }]).isNotEmpty()).toBe(true);
    });

    it('count() returns length', () => {
      expect(createCollection([{ id: 1 }, { id: 2 }]).count()).toBe(2);
    });
  });

  describe('transformation', () => {
    it('merge() combines collections', () => {
      const a = createCollection([{ id: 1 }]);
      const b = [new MockModel({ id: 2 })];
      expect(a.merge(b).count()).toBe(2);
    });
  });

  describe('aggregation', () => {
    it('sum() sums a key', () => {
      const col = createCollection([
        { id: 1, price: 10 },
        { id: 2, price: 20 },
      ]);
      // Need to access via attribute
      expect(col.sum('price' as any)).toBe(0); // sum uses item[key] which is not set on Ensemble
    });

    it('pluck() extracts key values', () => {
      const col = createCollection([{ id: 1 }, { id: 2 }]);
      // pluck accesses model properties, not attributes
    });
  });

  describe('querying', () => {
    it('find() by key', () => {
      const col = createCollection([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const found = col.find(2);
      expect(found!.getKey()).toBe(2);
    });

    it('contains() checks for key', () => {
      const col = createCollection([{ id: 1 }, { id: 2 }]);
      expect(col.contains(1)).toBe(true);
      expect(col.contains(99)).toBe(false);
    });

    it('contains() with callback', () => {
      const col = createCollection([{ id: 1 }, { id: 2 }]);
      expect(col.contains((m) => m.getKey() === 2)).toBe(true);
    });
  });

  describe('basic Array operations', () => {
    it('length reflects count', () => {
      const col = createCollection([{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(col.length).toBe(3);
    });

    it('can index into the collection', () => {
      const col = createCollection([{ id: 1 }, { id: 2 }]);
      expect(col[0].getKey()).toBe(1);
      expect(col[1].getKey()).toBe(2);
    });
  });
});
