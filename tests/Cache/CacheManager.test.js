"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const CacheManager_1 = require("../../src/Cache/CacheManager");
const ArrayStore_1 = require("../../src/Cache/Stores/ArrayStore");
const NullStore_1 = require("../../src/Cache/Stores/NullStore");
(0, vitest_1.describe)('CacheManager', () => {
    let manager;
    (0, vitest_1.beforeEach)(() => {
        manager = new CacheManager_1.CacheManager({
            default: 'array',
            prefix: 'app_',
            stores: {
                array: { driver: 'array' },
                null: { driver: 'null' },
            },
        });
        manager.registerDriver('array', (config) => new ArrayStore_1.ArrayStore(config));
        manager.registerDriver('null', () => new NullStore_1.NullStore());
    });
    (0, vitest_1.describe)('store()', () => {
        (0, vitest_1.it)('returns default store', () => {
            const repo = manager.store();
            (0, vitest_1.expect)(repo).toBeDefined();
        });
        (0, vitest_1.it)('returns named store', () => {
            const repo = manager.store('null');
            (0, vitest_1.expect)(repo).toBeDefined();
        });
        (0, vitest_1.it)('caches store instances', () => {
            const a = manager.store();
            const b = manager.store();
            (0, vitest_1.expect)(a).toBe(b);
        });
        (0, vitest_1.it)('throws for unconfigured store', () => {
            (0, vitest_1.expect)(() => manager.store('redis')).toThrow('Cache store [redis] not configured');
        });
        (0, vitest_1.it)('throws for unregistered driver', () => {
            const mgr = new CacheManager_1.CacheManager({
                default: 'custom',
                prefix: '',
                stores: { custom: { driver: 'custom' } },
            });
            (0, vitest_1.expect)(() => mgr.store()).toThrow('Cache driver [custom] not registered');
        });
    });
    (0, vitest_1.describe)('registerDriver() / extend()', () => {
        (0, vitest_1.it)('registers a custom driver', () => {
            manager.registerDriver('custom', () => new ArrayStore_1.ArrayStore());
            const mgr = new CacheManager_1.CacheManager({
                default: 'custom',
                prefix: '',
                stores: { custom: { driver: 'custom' } },
            });
            mgr.registerDriver('custom', () => new ArrayStore_1.ArrayStore());
            (0, vitest_1.expect)(mgr.store()).toBeDefined();
        });
        (0, vitest_1.it)('extend() is an alias for registerDriver()', () => {
            manager.extend('custom', () => new ArrayStore_1.ArrayStore());
            // extend just calls registerDriver internally
            const mgr = new CacheManager_1.CacheManager({
                default: 'test',
                prefix: '',
                stores: { test: { driver: 'custom' } },
            });
            mgr.extend('custom', () => new ArrayStore_1.ArrayStore());
            (0, vitest_1.expect)(mgr.store()).toBeDefined();
        });
    });
    (0, vitest_1.describe)('default driver', () => {
        (0, vitest_1.it)('getDefaultDriver() returns configured default', () => {
            (0, vitest_1.expect)(manager.getDefaultDriver()).toBe('array');
        });
        (0, vitest_1.it)('setDefaultDriver() changes default', () => {
            manager.setDefaultDriver('null');
            (0, vitest_1.expect)(manager.getDefaultDriver()).toBe('null');
        });
    });
    (0, vitest_1.describe)('getPrefix()', () => {
        (0, vitest_1.it)('returns configured prefix', () => {
            (0, vitest_1.expect)(manager.getPrefix()).toBe('app_');
        });
    });
    (0, vitest_1.describe)('getStoreNames()', () => {
        (0, vitest_1.it)('returns all configured store names', () => {
            (0, vitest_1.expect)(manager.getStoreNames()).toEqual(['array', 'null']);
        });
    });
    (0, vitest_1.describe)('getStoreConfig()', () => {
        (0, vitest_1.it)('returns config for named store', () => {
            const config = manager.getStoreConfig('array');
            (0, vitest_1.expect)(config.driver).toBe('array');
        });
        (0, vitest_1.it)('returns default store config when no name', () => {
            (0, vitest_1.expect)(manager.getStoreConfig().driver).toBe('array');
        });
        (0, vitest_1.it)('throws for unconfigured store', () => {
            (0, vitest_1.expect)(() => manager.getStoreConfig('redis')).toThrow('not configured');
        });
    });
    (0, vitest_1.describe)('getConfig()', () => {
        (0, vitest_1.it)('returns full configuration', () => {
            const config = manager.getConfig();
            (0, vitest_1.expect)(config.default).toBe('array');
            (0, vitest_1.expect)(config.stores).toHaveProperty('array');
            (0, vitest_1.expect)(config.stores).toHaveProperty('null');
        });
    });
    (0, vitest_1.describe)('purge()', () => {
        (0, vitest_1.it)('removes cached store instance', () => {
            const a = manager.store();
            manager.purge();
            const b = manager.store();
            (0, vitest_1.expect)(a).not.toBe(b);
        });
        (0, vitest_1.it)('purges specific store', () => {
            const a = manager.store('null');
            manager.purge('null');
            const b = manager.store('null');
            (0, vitest_1.expect)(a).not.toBe(b);
        });
    });
    (0, vitest_1.describe)('purgeAll()', () => {
        (0, vitest_1.it)('removes all cached store instances', () => {
            const arr = manager.store('array');
            const nul = manager.store('null');
            manager.purgeAll();
            (0, vitest_1.expect)(manager.store('array')).not.toBe(arr);
            (0, vitest_1.expect)(manager.store('null')).not.toBe(nul);
        });
    });
    (0, vitest_1.describe)('proxy methods', () => {
        (0, vitest_1.it)('get() proxies to default store', async () => {
            await manager.put('key', 'value', 3600);
            (0, vitest_1.expect)(await manager.get('key')).toBe('value');
        });
        (0, vitest_1.it)('has() proxies to default store', async () => {
            await manager.put('key', 'value', 3600);
            (0, vitest_1.expect)(await manager.has('key')).toBe(true);
        });
        (0, vitest_1.it)('forget() proxies to default store', async () => {
            await manager.put('key', 'value', 3600);
            await manager.forget('key');
            (0, vitest_1.expect)(await manager.has('key')).toBe(false);
        });
        (0, vitest_1.it)('flush() proxies to default store', async () => {
            await manager.put('a', 1, 3600);
            await manager.flush();
            (0, vitest_1.expect)(await manager.has('a')).toBe(false);
        });
        (0, vitest_1.it)('remember() proxies to default store', async () => {
            const result = await manager.remember('key', 3600, () => 'computed');
            (0, vitest_1.expect)(result).toBe('computed');
        });
        (0, vitest_1.it)('rememberForever() proxies to default store', async () => {
            const result = await manager.rememberForever('key', () => 'forever');
            (0, vitest_1.expect)(result).toBe('forever');
        });
        (0, vitest_1.it)('forever() proxies to default store', async () => {
            await manager.forever('key', 'val');
            (0, vitest_1.expect)(await manager.get('key')).toBe('val');
        });
        (0, vitest_1.it)('pull() proxies to default store', async () => {
            await manager.put('key', 'val', 3600);
            const result = await manager.pull('key');
            (0, vitest_1.expect)(result).toBe('val');
            (0, vitest_1.expect)(await manager.has('key')).toBe(false);
        });
        (0, vitest_1.it)('many() proxies to default store', async () => {
            await manager.put('a', 1, 3600);
            const result = await manager.many(['a', 'b']);
            (0, vitest_1.expect)(result.a).toBe(1);
        });
        (0, vitest_1.it)('putMany() proxies to default store', async () => {
            await manager.putMany({ x: 10 }, 3600);
            (0, vitest_1.expect)(await manager.get('x')).toBe(10);
        });
        (0, vitest_1.it)('add() proxies to default store', async () => {
            (0, vitest_1.expect)(await manager.add('key', 'val', 3600)).toBe(true);
            (0, vitest_1.expect)(await manager.add('key', 'other', 3600)).toBe(false);
        });
        (0, vitest_1.it)('increment() / decrement() proxy to default store', async () => {
            await manager.put('c', 5, 3600);
            await manager.increment('c', 3);
            (0, vitest_1.expect)(await manager.get('c')).toBe(8);
            await manager.decrement('c', 2);
            (0, vitest_1.expect)(await manager.get('c')).toBe(6);
        });
    });
});
//# sourceMappingURL=CacheManager.test.js.map