"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const Repository_1 = require("../../src/Cache/Repository");
const ArrayStore_1 = require("../../src/Cache/Stores/ArrayStore");
(0, vitest_1.describe)('Repository', () => {
    let store;
    let repo;
    (0, vitest_1.beforeEach)(() => {
        store = new ArrayStore_1.ArrayStore({ serialize: false });
        repo = new Repository_1.Repository(store);
    });
    (0, vitest_1.describe)('get()', () => {
        (0, vitest_1.it)('returns cached value', async () => {
            await repo.put('key', 'value', 3600);
            (0, vitest_1.expect)(await repo.get('key')).toBe('value');
        });
        (0, vitest_1.it)('returns default for missing keys', async () => {
            (0, vitest_1.expect)(await repo.get('missing', 'default')).toBe('default');
        });
        (0, vitest_1.it)('returns null when no default', async () => {
            (0, vitest_1.expect)(await repo.get('missing')).toBeNull();
        });
        (0, vitest_1.it)('calls default function if provided', async () => {
            const result = await repo.get('missing', () => 'computed');
            (0, vitest_1.expect)(result).toBe('computed');
        });
    });
    (0, vitest_1.describe)('put()', () => {
        (0, vitest_1.it)('stores a value', async () => {
            const result = await repo.put('key', 'value', 3600);
            (0, vitest_1.expect)(result).toBe(true);
        });
        (0, vitest_1.it)('uses Date for TTL', async () => {
            const future = new Date(Date.now() + 60000);
            await repo.put('key', 'value', future);
            (0, vitest_1.expect)(await repo.get('key')).toBe('value');
        });
        (0, vitest_1.it)('stores forever when no TTL and no default', async () => {
            repo.setDefaultCacheTime(null);
            await repo.put('key', 'value');
            (0, vitest_1.expect)(await repo.get('key')).toBe('value');
        });
        (0, vitest_1.it)('forgets key when TTL is 0 or negative', async () => {
            await repo.put('key', 'value', 3600);
            await repo.put('key', 'new', 0);
            // TTL <= 0 causes forget
            (0, vitest_1.expect)(await repo.get('key')).toBeNull();
        });
    });
    (0, vitest_1.describe)('has() / missing()', () => {
        (0, vitest_1.it)('has() returns true for existing keys', async () => {
            await repo.put('key', 'value', 3600);
            (0, vitest_1.expect)(await repo.has('key')).toBe(true);
        });
        (0, vitest_1.it)('has() returns false for missing keys', async () => {
            (0, vitest_1.expect)(await repo.has('missing')).toBe(false);
        });
        (0, vitest_1.it)('missing() is inverse of has()', async () => {
            await repo.put('key', 'value', 3600);
            (0, vitest_1.expect)(await repo.missing('key')).toBe(false);
            (0, vitest_1.expect)(await repo.missing('absent')).toBe(true);
        });
    });
    (0, vitest_1.describe)('pull()', () => {
        (0, vitest_1.it)('gets and removes value', async () => {
            await repo.put('key', 'value', 3600);
            const result = await repo.pull('key');
            (0, vitest_1.expect)(result).toBe('value');
            (0, vitest_1.expect)(await repo.get('key')).toBeNull();
        });
        (0, vitest_1.it)('returns default if missing', async () => {
            (0, vitest_1.expect)(await repo.pull('missing', 'fallback')).toBe('fallback');
        });
    });
    (0, vitest_1.describe)('add()', () => {
        (0, vitest_1.it)('stores only if key does not exist', async () => {
            (0, vitest_1.expect)(await repo.add('key', 'first', 3600)).toBe(true);
            (0, vitest_1.expect)(await repo.add('key', 'second', 3600)).toBe(false);
            (0, vitest_1.expect)(await repo.get('key')).toBe('first');
        });
    });
    (0, vitest_1.describe)('remember()', () => {
        (0, vitest_1.it)('returns cached value if exists', async () => {
            await repo.put('key', 'cached', 3600);
            const result = await repo.remember('key', 3600, () => 'fresh');
            (0, vitest_1.expect)(result).toBe('cached');
        });
        (0, vitest_1.it)('calls callback and caches if missing', async () => {
            const result = await repo.remember('key', 3600, () => 'computed');
            (0, vitest_1.expect)(result).toBe('computed');
            (0, vitest_1.expect)(await repo.get('key')).toBe('computed');
        });
        (0, vitest_1.it)('handles async callbacks', async () => {
            const result = await repo.remember('key', 3600, async () => 'async-val');
            (0, vitest_1.expect)(result).toBe('async-val');
        });
    });
    (0, vitest_1.describe)('rememberForever()', () => {
        (0, vitest_1.it)('returns cached value if exists', async () => {
            await repo.forever('key', 'cached');
            const result = await repo.rememberForever('key', () => 'fresh');
            (0, vitest_1.expect)(result).toBe('cached');
        });
        (0, vitest_1.it)('calls callback and caches forever', async () => {
            const result = await repo.rememberForever('key', () => 'computed');
            (0, vitest_1.expect)(result).toBe('computed');
            (0, vitest_1.expect)(await repo.get('key')).toBe('computed');
        });
    });
    (0, vitest_1.describe)('forever()', () => {
        (0, vitest_1.it)('stores a value permanently', async () => {
            await repo.forever('key', 'permanent');
            (0, vitest_1.expect)(await repo.get('key')).toBe('permanent');
        });
    });
    (0, vitest_1.describe)('forget()', () => {
        (0, vitest_1.it)('removes a key', async () => {
            await repo.put('key', 'value', 3600);
            await repo.forget('key');
            (0, vitest_1.expect)(await repo.get('key')).toBeNull();
        });
    });
    (0, vitest_1.describe)('flush()', () => {
        (0, vitest_1.it)('clears all entries', async () => {
            await repo.put('a', 1, 3600);
            await repo.put('b', 2, 3600);
            await repo.flush();
            (0, vitest_1.expect)(await repo.get('a')).toBeNull();
            (0, vitest_1.expect)(await repo.get('b')).toBeNull();
        });
    });
    (0, vitest_1.describe)('many() / putMany()', () => {
        (0, vitest_1.it)('gets multiple keys', async () => {
            await repo.put('a', 1, 3600);
            await repo.put('b', 2, 3600);
            const result = await repo.many(['a', 'b', 'c']);
            (0, vitest_1.expect)(result.a).toBe(1);
            (0, vitest_1.expect)(result.b).toBe(2);
            (0, vitest_1.expect)(result.c).toBeNull();
        });
        (0, vitest_1.it)('puts multiple values', async () => {
            await repo.putMany({ x: 10, y: 20 }, 3600);
            (0, vitest_1.expect)(await repo.get('x')).toBe(10);
            (0, vitest_1.expect)(await repo.get('y')).toBe(20);
        });
    });
    (0, vitest_1.describe)('increment() / decrement()', () => {
        (0, vitest_1.it)('increments a value', async () => {
            await repo.put('counter', 5, 3600);
            const result = await repo.increment('counter', 3);
            (0, vitest_1.expect)(result).toBe(8);
        });
        (0, vitest_1.it)('decrements a value', async () => {
            await repo.put('counter', 10, 3600);
            const result = await repo.decrement('counter', 2);
            (0, vitest_1.expect)(result).toBe(8);
        });
    });
    (0, vitest_1.describe)('lock()', () => {
        (0, vitest_1.it)('creates a lock', () => {
            const lock = repo.lock('resource', 10);
            (0, vitest_1.expect)(lock).toBeDefined();
        });
    });
    (0, vitest_1.describe)('restoreLock()', () => {
        (0, vitest_1.it)('restores a lock with owner', () => {
            const lock = repo.restoreLock('resource', 'owner-123');
            (0, vitest_1.expect)(lock).toBeDefined();
        });
    });
    (0, vitest_1.describe)('tags()', () => {
        (0, vitest_1.it)('returns a TaggedCache', () => {
            const tagged = repo.tags(['tag1', 'tag2']);
            (0, vitest_1.expect)(tagged).toBeDefined();
        });
        (0, vitest_1.it)('accepts a string tag', () => {
            const tagged = repo.tags('single-tag');
            (0, vitest_1.expect)(tagged).toBeDefined();
        });
    });
    (0, vitest_1.describe)('accessors', () => {
        (0, vitest_1.it)('getStore() returns the underlying store', () => {
            (0, vitest_1.expect)(repo.getStore()).toBe(store);
        });
        (0, vitest_1.it)('getDefaultCacheTime() returns null by default', () => {
            (0, vitest_1.expect)(repo.getDefaultCacheTime()).toBeNull();
        });
        (0, vitest_1.it)('setDefaultCacheTime() sets the default', () => {
            repo.setDefaultCacheTime(3600);
            (0, vitest_1.expect)(repo.getDefaultCacheTime()).toBe(3600);
        });
        (0, vitest_1.it)('getPrefix() delegates to store', () => {
            (0, vitest_1.expect)(repo.getPrefix()).toBe('');
        });
    });
});
//# sourceMappingURL=Repository.test.js.map