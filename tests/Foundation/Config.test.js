"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const Config_1 = require("../../src/Foundation/Config/Config");
(0, vitest_1.describe)('Config', () => {
    let config;
    (0, vitest_1.beforeEach)(() => {
        config = new Config_1.Config({
            app: {
                name: 'Orchestr',
                debug: true,
                url: 'http://localhost',
                nested: {
                    deep: 'value',
                },
            },
            database: {
                default: 'sqlite',
                connections: {
                    sqlite: { driver: 'sqlite', database: ':memory:' },
                    mysql: { driver: 'mysql', host: 'localhost', port: 3306 },
                },
            },
            providers: ['ProviderA', 'ProviderB'],
        });
    });
    (0, vitest_1.describe)('get()', () => {
        (0, vitest_1.it)('gets top-level values', () => {
            (0, vitest_1.expect)(config.get('app')).toEqual({
                name: 'Orchestr',
                debug: true,
                url: 'http://localhost',
                nested: { deep: 'value' },
            });
        });
        (0, vitest_1.it)('gets nested values with dot notation', () => {
            (0, vitest_1.expect)(config.get('app.name')).toBe('Orchestr');
            (0, vitest_1.expect)(config.get('app.debug')).toBe(true);
        });
        (0, vitest_1.it)('gets deeply nested values', () => {
            (0, vitest_1.expect)(config.get('database.connections.sqlite.driver')).toBe('sqlite');
            (0, vitest_1.expect)(config.get('database.connections.mysql.port')).toBe(3306);
            (0, vitest_1.expect)(config.get('app.nested.deep')).toBe('value');
        });
        (0, vitest_1.it)('returns default value for missing keys', () => {
            (0, vitest_1.expect)(config.get('nonexistent', 'fallback')).toBe('fallback');
            (0, vitest_1.expect)(config.get('app.missing', 42)).toBe(42);
        });
        (0, vitest_1.it)('returns undefined when no default provided', () => {
            (0, vitest_1.expect)(config.get('nonexistent')).toBeUndefined();
        });
        (0, vitest_1.it)('returns arrays correctly', () => {
            (0, vitest_1.expect)(config.get('providers')).toEqual(['ProviderA', 'ProviderB']);
        });
    });
    (0, vitest_1.describe)('has()', () => {
        (0, vitest_1.it)('returns true for existing keys', () => {
            (0, vitest_1.expect)(config.has('app')).toBe(true);
            (0, vitest_1.expect)(config.has('app.name')).toBe(true);
            (0, vitest_1.expect)(config.has('database.connections.sqlite')).toBe(true);
        });
        (0, vitest_1.it)('returns false for missing keys', () => {
            (0, vitest_1.expect)(config.has('nonexistent')).toBe(false);
            (0, vitest_1.expect)(config.has('app.nonexistent')).toBe(false);
        });
    });
    (0, vitest_1.describe)('all()', () => {
        (0, vitest_1.it)('returns all configuration items', () => {
            const all = config.all();
            (0, vitest_1.expect)(all).toHaveProperty('app');
            (0, vitest_1.expect)(all).toHaveProperty('database');
            (0, vitest_1.expect)(all).toHaveProperty('providers');
        });
    });
    (0, vitest_1.describe)('set()', () => {
        (0, vitest_1.it)('sets top-level values', () => {
            config.set('newKey', 'newValue');
            (0, vitest_1.expect)(config.get('newKey')).toBe('newValue');
        });
        (0, vitest_1.it)('sets nested values with dot notation', () => {
            config.set('app.timezone', 'UTC');
            (0, vitest_1.expect)(config.get('app.timezone')).toBe('UTC');
        });
        (0, vitest_1.it)('creates intermediate objects', () => {
            config.set('new.deep.key', 'created');
            (0, vitest_1.expect)(config.get('new.deep.key')).toBe('created');
        });
        (0, vitest_1.it)('overwrites existing values', () => {
            config.set('app.name', 'NewName');
            (0, vitest_1.expect)(config.get('app.name')).toBe('NewName');
        });
        (0, vitest_1.it)('accepts object to set multiple values', () => {
            config.set({ 'app.name': 'Updated', 'app.env': 'testing' });
            (0, vitest_1.expect)(config.get('app.name')).toBe('Updated');
            (0, vitest_1.expect)(config.get('app.env')).toBe('testing');
        });
    });
    (0, vitest_1.describe)('forget()', () => {
        (0, vitest_1.it)('removes a key', () => {
            config.forget('app.debug');
            (0, vitest_1.expect)(config.has('app.debug')).toBe(false);
        });
        (0, vitest_1.it)('does not throw for nonexistent keys', () => {
            (0, vitest_1.expect)(() => config.forget('nonexistent.key')).not.toThrow();
        });
        (0, vitest_1.it)('removes top-level keys', () => {
            config.forget('providers');
            (0, vitest_1.expect)(config.has('providers')).toBe(false);
        });
    });
    (0, vitest_1.describe)('prepend()', () => {
        (0, vitest_1.it)('prepends to an array', () => {
            config.prepend('providers', 'ProviderZ');
            (0, vitest_1.expect)(config.get('providers')[0]).toBe('ProviderZ');
        });
        (0, vitest_1.it)('creates array if key is missing', () => {
            config.prepend('new.array', 'first');
            (0, vitest_1.expect)(config.get('new.array')).toEqual(['first']);
        });
        (0, vitest_1.it)('throws if value is not an array', () => {
            (0, vitest_1.expect)(() => config.prepend('app.name', 'val')).toThrow('not an array');
        });
    });
    (0, vitest_1.describe)('push()', () => {
        (0, vitest_1.it)('pushes to an array', () => {
            config.push('providers', 'ProviderC');
            const providers = config.get('providers');
            (0, vitest_1.expect)(providers[providers.length - 1]).toBe('ProviderC');
        });
        (0, vitest_1.it)('creates array if key is missing', () => {
            config.push('new.list', 'item');
            (0, vitest_1.expect)(config.get('new.list')).toEqual(['item']);
        });
        (0, vitest_1.it)('throws if value is not an array', () => {
            (0, vitest_1.expect)(() => config.push('app.name', 'val')).toThrow('not an array');
        });
    });
    (0, vitest_1.describe)('getMany()', () => {
        (0, vitest_1.it)('returns values for multiple keys', () => {
            const result = config.getMany(['app.name', 'database.default']);
            (0, vitest_1.expect)(result).toEqual({
                'app.name': 'Orchestr',
                'database.default': 'sqlite',
            });
        });
        (0, vitest_1.it)('includes undefined for missing keys', () => {
            const result = config.getMany(['app.name', 'missing']);
            (0, vitest_1.expect)(result['app.name']).toBe('Orchestr');
            (0, vitest_1.expect)(result['missing']).toBeUndefined();
        });
    });
    (0, vitest_1.describe)('merge()', () => {
        (0, vitest_1.it)('deep merges configuration', () => {
            config.merge({
                app: {
                    name: 'Merged',
                    extra: 'new',
                },
            });
            (0, vitest_1.expect)(config.get('app.name')).toBe('Merged');
            (0, vitest_1.expect)(config.get('app.extra')).toBe('new');
            (0, vitest_1.expect)(config.get('app.debug')).toBe(true); // preserved
        });
        (0, vitest_1.it)('adds new top-level keys', () => {
            config.merge({ cache: { driver: 'array' } });
            (0, vitest_1.expect)(config.get('cache.driver')).toBe('array');
        });
        (0, vitest_1.it)('overwrites non-object values', () => {
            config.merge({ providers: ['NewProvider'] });
            (0, vitest_1.expect)(config.get('providers')).toEqual(['NewProvider']);
        });
    });
    (0, vitest_1.describe)('empty config', () => {
        (0, vitest_1.it)('works with no initial items', () => {
            const empty = new Config_1.Config();
            (0, vitest_1.expect)(empty.all()).toEqual({});
            (0, vitest_1.expect)(empty.has('anything')).toBe(false);
            (0, vitest_1.expect)(empty.get('anything', 'default')).toBe('default');
        });
    });
});
//# sourceMappingURL=Config.test.js.map