"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const ArrayStore_1 = require("../../src/Cache/Stores/ArrayStore");
(0, vitest_1.describe)('ArrayStore', () => {
    let store;
    (0, vitest_1.beforeEach)(() => {
        store = new ArrayStore_1.ArrayStore({}, 'test_');
    });
    (0, vitest_1.describe)('get()', () => {
        (0, vitest_1.it)('returns null for missing keys', async () => {
            (0, vitest_1.expect)(await store.get('nonexistent')).toBeNull();
        });
        (0, vitest_1.it)('returns stored value', async () => {
            await store.put('key', 'value', 3600);
            (0, vitest_1.expect)(await store.get('key')).toBe('value');
        });
        (0, vitest_1.it)('returns null for expired entries', async () => {
            // Put with very short TTL
            await store.put('key', 'value', 1);
            // Manually expire by advancing time
            vitest_1.vi.useFakeTimers();
            vitest_1.vi.advanceTimersByTime(2000);
            (0, vitest_1.expect)(await store.get('key')).toBeNull();
            vitest_1.vi.useRealTimers();
        });
        (0, vitest_1.it)('uses prefix for key storage', async () => {
            await store.put('key', 'value', 3600);
            // Key stored with prefix test_key
            (0, vitest_1.expect)(await store.get('key')).toBe('value');
        });
    });
    (0, vitest_1.describe)('put()', () => {
        (0, vitest_1.it)('stores a value with TTL', async () => {
            const result = await store.put('key', 'value', 3600);
            (0, vitest_1.expect)(result).toBe(true);
            (0, vitest_1.expect)(await store.get('key')).toBe('value');
        });
        (0, vitest_1.it)('stores values forever when TTL is 0', async () => {
            await store.put('key', 'forever', 0);
            (0, vitest_1.expect)(await store.get('key')).toBe('forever');
        });
        (0, vitest_1.it)('stores complex objects', async () => {
            await store.put('obj', { name: 'test', count: 42 }, 3600);
            const result = await store.get('obj');
            (0, vitest_1.expect)(result).toEqual({ name: 'test', count: 42 });
        });
        (0, vitest_1.it)('overwrites existing values', async () => {
            await store.put('key', 'first', 3600);
            await store.put('key', 'second', 3600);
            (0, vitest_1.expect)(await store.get('key')).toBe('second');
        });
    });
    (0, vitest_1.describe)('many()', () => {
        (0, vitest_1.it)('gets multiple keys at once', async () => {
            await store.put('a', 1, 3600);
            await store.put('b', 2, 3600);
            const result = await store.many(['a', 'b', 'c']);
            (0, vitest_1.expect)(result.a).toBe(1);
            (0, vitest_1.expect)(result.b).toBe(2);
            (0, vitest_1.expect)(result.c).toBeNull();
        });
    });
    (0, vitest_1.describe)('putMany()', () => {
        (0, vitest_1.it)('stores multiple values', async () => {
            await store.putMany({ a: 1, b: 2 }, 3600);
            (0, vitest_1.expect)(await store.get('a')).toBe(1);
            (0, vitest_1.expect)(await store.get('b')).toBe(2);
        });
    });
    (0, vitest_1.describe)('increment() / decrement()', () => {
        (0, vitest_1.it)('increments a value', async () => {
            await store.put('counter', 5, 3600);
            const result = await store.increment('counter', 3);
            (0, vitest_1.expect)(result).toBe(8);
            (0, vitest_1.expect)(await store.get('counter')).toBe(8);
        });
        (0, vitest_1.it)('starts from 0 for missing keys', async () => {
            const result = await store.increment('missing', 1);
            (0, vitest_1.expect)(result).toBe(1);
        });
        (0, vitest_1.it)('decrements a value', async () => {
            await store.put('counter', 10, 3600);
            const result = await store.decrement('counter', 3);
            (0, vitest_1.expect)(result).toBe(7);
        });
        (0, vitest_1.it)('defaults to incrementing by 1', async () => {
            await store.put('counter', 0, 3600);
            await store.increment('counter');
            (0, vitest_1.expect)(await store.get('counter')).toBe(1);
        });
    });
    (0, vitest_1.describe)('forever()', () => {
        (0, vitest_1.it)('stores a value without expiration', async () => {
            await store.forever('key', 'permanent');
            (0, vitest_1.expect)(await store.get('key')).toBe('permanent');
        });
    });
    (0, vitest_1.describe)('forget()', () => {
        (0, vitest_1.it)('removes a key', async () => {
            await store.put('key', 'value', 3600);
            const result = await store.forget('key');
            (0, vitest_1.expect)(result).toBe(true);
            (0, vitest_1.expect)(await store.get('key')).toBeNull();
        });
        (0, vitest_1.it)('returns false for missing key', async () => {
            const result = await store.forget('nonexistent');
            (0, vitest_1.expect)(result).toBe(false);
        });
    });
    (0, vitest_1.describe)('flush()', () => {
        (0, vitest_1.it)('clears all entries', async () => {
            await store.put('a', 1, 3600);
            await store.put('b', 2, 3600);
            const result = await store.flush();
            (0, vitest_1.expect)(result).toBe(true);
            (0, vitest_1.expect)(await store.get('a')).toBeNull();
            (0, vitest_1.expect)(await store.get('b')).toBeNull();
        });
    });
    (0, vitest_1.describe)('getPrefix()', () => {
        (0, vitest_1.it)('returns the configured prefix', () => {
            (0, vitest_1.expect)(store.getPrefix()).toBe('test_');
        });
        (0, vitest_1.it)('returns empty prefix by default', () => {
            const noPrefix = new ArrayStore_1.ArrayStore();
            (0, vitest_1.expect)(noPrefix.getPrefix()).toBe('');
        });
    });
    (0, vitest_1.describe)('serialization', () => {
        (0, vitest_1.it)('serializes by default', async () => {
            const store = new ArrayStore_1.ArrayStore({});
            await store.put('key', { a: 1 }, 3600);
            (0, vitest_1.expect)(await store.get('key')).toEqual({ a: 1 });
        });
        (0, vitest_1.it)('can disable serialization', async () => {
            const store = new ArrayStore_1.ArrayStore({ serialize: false });
            await store.put('key', 'value', 3600);
            (0, vitest_1.expect)(await store.get('key')).toBe('value');
        });
    });
});
//# sourceMappingURL=ArrayStore.test.js.map