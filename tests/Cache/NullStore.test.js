"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const NullStore_1 = require("../../src/Cache/Stores/NullStore");
(0, vitest_1.describe)('NullStore', () => {
    const store = new NullStore_1.NullStore();
    (0, vitest_1.it)('get() always returns null', async () => {
        (0, vitest_1.expect)(await store.get('any')).toBeNull();
    });
    (0, vitest_1.it)('many() returns all nulls', async () => {
        const result = await store.many(['a', 'b']);
        (0, vitest_1.expect)(result).toEqual({ a: null, b: null });
    });
    (0, vitest_1.it)('put() returns false', async () => {
        (0, vitest_1.expect)(await store.put('key', 'value', 3600)).toBe(false);
    });
    (0, vitest_1.it)('putMany() returns false', async () => {
        (0, vitest_1.expect)(await store.putMany({ a: 1 }, 3600)).toBe(false);
    });
    (0, vitest_1.it)('increment() returns false', async () => {
        (0, vitest_1.expect)(await store.increment('key', 1)).toBe(false);
    });
    (0, vitest_1.it)('decrement() returns false', async () => {
        (0, vitest_1.expect)(await store.decrement('key', 1)).toBe(false);
    });
    (0, vitest_1.it)('forever() returns false', async () => {
        (0, vitest_1.expect)(await store.forever('key', 'value')).toBe(false);
    });
    (0, vitest_1.it)('forget() returns true', async () => {
        (0, vitest_1.expect)(await store.forget('key')).toBe(true);
    });
    (0, vitest_1.it)('flush() returns true', async () => {
        (0, vitest_1.expect)(await store.flush()).toBe(true);
    });
    (0, vitest_1.it)('getPrefix() returns empty string', () => {
        (0, vitest_1.expect)(store.getPrefix()).toBe('');
    });
});
//# sourceMappingURL=NullStore.test.js.map