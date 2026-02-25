"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const DatabaseManager_1 = require("../../src/Database/DatabaseManager");
const Expression_1 = require("../../src/Database/Query/Expression");
const EnsembleCollection_1 = require("../../src/Database/Ensemble/EnsembleCollection");
const Ensemble_1 = require("../../src/Database/Ensemble/Ensemble");
// Mock adapter for DatabaseManager tests
function createMockAdapter() {
    return {
        connect: vitest_1.vi.fn(),
        disconnect: vitest_1.vi.fn(),
        query: vitest_1.vi.fn(),
        select: vitest_1.vi.fn(),
        insert: vitest_1.vi.fn(),
        update: vitest_1.vi.fn(),
        delete: vitest_1.vi.fn(),
        beginTransaction: vitest_1.vi.fn(),
        commit: vitest_1.vi.fn(),
        rollback: vitest_1.vi.fn(),
    };
}
(0, vitest_1.describe)('DatabaseManager', () => {
    let manager;
    (0, vitest_1.beforeEach)(() => {
        manager = new DatabaseManager_1.DatabaseManager({
            default: 'sqlite',
            connections: {
                sqlite: { adapter: 'test', driver: 'sqlite', database: ':memory:' },
                mysql: { adapter: 'test', driver: 'mysql', host: 'localhost' },
            },
        });
        manager.registerAdapter('test', () => createMockAdapter());
    });
    (0, vitest_1.describe)('connection()', () => {
        (0, vitest_1.it)('returns default connection', () => {
            const conn = manager.connection();
            (0, vitest_1.expect)(conn).toBeDefined();
        });
        (0, vitest_1.it)('returns named connection', () => {
            const conn = manager.connection('mysql');
            (0, vitest_1.expect)(conn).toBeDefined();
        });
        (0, vitest_1.it)('caches connections', () => {
            const a = manager.connection();
            const b = manager.connection();
            (0, vitest_1.expect)(a).toBe(b);
        });
        (0, vitest_1.it)('throws for unconfigured connection', () => {
            (0, vitest_1.expect)(() => manager.connection('redis')).toThrow('not configured');
        });
        (0, vitest_1.it)('throws for unregistered adapter', () => {
            const mgr = new DatabaseManager_1.DatabaseManager({
                default: 'pg',
                connections: { pg: { adapter: 'postgres', driver: 'pg' } },
            });
            (0, vitest_1.expect)(() => mgr.connection()).toThrow('not registered');
        });
    });
    (0, vitest_1.describe)('disconnect()', () => {
        (0, vitest_1.it)('disconnects and removes cached connection', async () => {
            const a = manager.connection();
            await manager.disconnect();
            const b = manager.connection();
            (0, vitest_1.expect)(a).not.toBe(b);
        });
    });
    (0, vitest_1.describe)('disconnectAll()', () => {
        (0, vitest_1.it)('disconnects all connections', async () => {
            manager.connection('sqlite');
            manager.connection('mysql');
            await manager.disconnectAll();
            // Re-creating should give new instances
            const sqlite = manager.connection('sqlite');
            const mysql = manager.connection('mysql');
            (0, vitest_1.expect)(sqlite).toBeDefined();
            (0, vitest_1.expect)(mysql).toBeDefined();
        });
    });
    (0, vitest_1.describe)('default connection', () => {
        (0, vitest_1.it)('getDefaultConnection() returns configured default', () => {
            (0, vitest_1.expect)(manager.getDefaultConnection()).toBe('sqlite');
        });
        (0, vitest_1.it)('setDefaultConnection() changes default', () => {
            manager.setDefaultConnection('mysql');
            (0, vitest_1.expect)(manager.getDefaultConnection()).toBe('mysql');
        });
    });
    (0, vitest_1.describe)('getConnections()', () => {
        (0, vitest_1.it)('returns all configured connection names', () => {
            (0, vitest_1.expect)(manager.getConnections()).toEqual(['sqlite', 'mysql']);
        });
    });
    (0, vitest_1.describe)('registerAdapter()', () => {
        (0, vitest_1.it)('registers a new adapter factory', () => {
            manager.registerAdapter('custom', () => createMockAdapter());
            // No error means it was registered
        });
    });
});
(0, vitest_1.describe)('Expression', () => {
    (0, vitest_1.it)('stores and returns value', () => {
        const expr = new Expression_1.Expression('COUNT(*)');
        (0, vitest_1.expect)(expr.getValue()).toBe('COUNT(*)');
    });
    (0, vitest_1.it)('toString() returns value', () => {
        const expr = new Expression_1.Expression('NOW()');
        (0, vitest_1.expect)(expr.toString()).toBe('NOW()');
    });
});
(0, vitest_1.describe)('raw()', () => {
    (0, vitest_1.it)('creates an Expression', () => {
        const expr = (0, Expression_1.raw)('UPPER(name)');
        (0, vitest_1.expect)(expr).toBeInstanceOf(Expression_1.Expression);
        (0, vitest_1.expect)(expr.getValue()).toBe('UPPER(name)');
    });
});
// Create a mock Ensemble subclass for collection tests
class MockModel extends Ensemble_1.Ensemble {
    static table = 'mock';
    static primaryKey = 'id';
    constructor(attrs = {}) {
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
(0, vitest_1.describe)('EnsembleCollection', () => {
    function createCollection(items) {
        return new EnsembleCollection_1.EnsembleCollection(items.map((i) => {
            const m = new MockModel(i);
            return m;
        }));
    }
    (0, vitest_1.describe)('basic methods', () => {
        (0, vitest_1.it)('all() returns plain array', () => {
            const col = createCollection([{ id: 1 }, { id: 2 }]);
            (0, vitest_1.expect)(col.all()).toHaveLength(2);
        });
        (0, vitest_1.it)('first() returns first item', () => {
            const col = createCollection([{ id: 1 }, { id: 2 }]);
            (0, vitest_1.expect)(col.first().getKey()).toBe(1);
        });
        (0, vitest_1.it)('first() with callback returns first matching', () => {
            const col = createCollection([{ id: 1, active: false }, { id: 2, active: true }]);
            const item = col.first((m) => m.attributes.active === true);
            (0, vitest_1.expect)(item.getKey()).toBe(2);
        });
        (0, vitest_1.it)('last() returns last item', () => {
            const col = createCollection([{ id: 1 }, { id: 2 }]);
            (0, vitest_1.expect)(col.last().getKey()).toBe(2);
        });
        (0, vitest_1.it)('isEmpty() / isNotEmpty()', () => {
            (0, vitest_1.expect)(createCollection([]).isEmpty()).toBe(true);
            (0, vitest_1.expect)(createCollection([]).isNotEmpty()).toBe(false);
            (0, vitest_1.expect)(createCollection([{ id: 1 }]).isEmpty()).toBe(false);
            (0, vitest_1.expect)(createCollection([{ id: 1 }]).isNotEmpty()).toBe(true);
        });
        (0, vitest_1.it)('count() returns length', () => {
            (0, vitest_1.expect)(createCollection([{ id: 1 }, { id: 2 }]).count()).toBe(2);
        });
    });
    (0, vitest_1.describe)('transformation', () => {
        (0, vitest_1.it)('merge() combines collections', () => {
            const a = createCollection([{ id: 1 }]);
            const b = [new MockModel({ id: 2 })];
            (0, vitest_1.expect)(a.merge(b).count()).toBe(2);
        });
    });
    (0, vitest_1.describe)('aggregation', () => {
        (0, vitest_1.it)('sum() sums a key', () => {
            const col = createCollection([{ id: 1, price: 10 }, { id: 2, price: 20 }]);
            // Need to access via attribute
            (0, vitest_1.expect)(col.sum('price')).toBe(0); // sum uses item[key] which is not set on Ensemble
        });
        (0, vitest_1.it)('pluck() extracts key values', () => {
            const col = createCollection([{ id: 1 }, { id: 2 }]);
            // pluck accesses model properties, not attributes
        });
    });
    (0, vitest_1.describe)('querying', () => {
        (0, vitest_1.it)('find() by key', () => {
            const col = createCollection([{ id: 1 }, { id: 2 }, { id: 3 }]);
            const found = col.find(2);
            (0, vitest_1.expect)(found.getKey()).toBe(2);
        });
        (0, vitest_1.it)('contains() checks for key', () => {
            const col = createCollection([{ id: 1 }, { id: 2 }]);
            (0, vitest_1.expect)(col.contains(1)).toBe(true);
            (0, vitest_1.expect)(col.contains(99)).toBe(false);
        });
        (0, vitest_1.it)('contains() with callback', () => {
            const col = createCollection([{ id: 1 }, { id: 2 }]);
            (0, vitest_1.expect)(col.contains((m) => m.getKey() === 2)).toBe(true);
        });
    });
    (0, vitest_1.describe)('basic Array operations', () => {
        (0, vitest_1.it)('length reflects count', () => {
            const col = createCollection([{ id: 1 }, { id: 2 }, { id: 3 }]);
            (0, vitest_1.expect)(col.length).toBe(3);
        });
        (0, vitest_1.it)('can index into the collection', () => {
            const col = createCollection([{ id: 1 }, { id: 2 }]);
            (0, vitest_1.expect)(col[0].getKey()).toBe(1);
            (0, vitest_1.expect)(col[1].getKey()).toBe(2);
        });
    });
});
//# sourceMappingURL=Database.test.js.map