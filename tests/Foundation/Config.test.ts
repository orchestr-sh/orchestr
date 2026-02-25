import { describe, it, expect, beforeEach } from 'vitest';
import { Config } from '@/Foundation/Config/Config';

describe('Config', () => {
  let config: Config;

  beforeEach(() => {
    config = new Config({
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

  describe('get()', () => {
    it('gets top-level values', () => {
      expect(config.get('app')).toEqual({
        name: 'Orchestr',
        debug: true,
        url: 'http://localhost',
        nested: { deep: 'value' },
      });
    });

    it('gets nested values with dot notation', () => {
      expect(config.get('app.name')).toBe('Orchestr');
      expect(config.get('app.debug')).toBe(true);
    });

    it('gets deeply nested values', () => {
      expect(config.get('database.connections.sqlite.driver')).toBe('sqlite');
      expect(config.get('database.connections.mysql.port')).toBe(3306);
      expect(config.get('app.nested.deep')).toBe('value');
    });

    it('returns default value for missing keys', () => {
      expect(config.get('nonexistent', 'fallback')).toBe('fallback');
      expect(config.get('app.missing', 42)).toBe(42);
    });

    it('returns undefined when no default provided', () => {
      expect(config.get('nonexistent')).toBeUndefined();
    });

    it('returns arrays correctly', () => {
      expect(config.get('providers')).toEqual(['ProviderA', 'ProviderB']);
    });
  });

  describe('has()', () => {
    it('returns true for existing keys', () => {
      expect(config.has('app')).toBe(true);
      expect(config.has('app.name')).toBe(true);
      expect(config.has('database.connections.sqlite')).toBe(true);
    });

    it('returns false for missing keys', () => {
      expect(config.has('nonexistent')).toBe(false);
      expect(config.has('app.nonexistent')).toBe(false);
    });
  });

  describe('all()', () => {
    it('returns all configuration items', () => {
      const all = config.all();
      expect(all).toHaveProperty('app');
      expect(all).toHaveProperty('database');
      expect(all).toHaveProperty('providers');
    });
  });

  describe('set()', () => {
    it('sets top-level values', () => {
      config.set('newKey', 'newValue');
      expect(config.get('newKey')).toBe('newValue');
    });

    it('sets nested values with dot notation', () => {
      config.set('app.timezone', 'UTC');
      expect(config.get('app.timezone')).toBe('UTC');
    });

    it('creates intermediate objects', () => {
      config.set('new.deep.key', 'created');
      expect(config.get('new.deep.key')).toBe('created');
    });

    it('overwrites existing values', () => {
      config.set('app.name', 'NewName');
      expect(config.get('app.name')).toBe('NewName');
    });

    it('accepts object to set multiple values', () => {
      config.set({ 'app.name': 'Updated', 'app.env': 'testing' });
      expect(config.get('app.name')).toBe('Updated');
      expect(config.get('app.env')).toBe('testing');
    });
  });

  describe('forget()', () => {
    it('removes a key', () => {
      config.forget('app.debug');
      expect(config.has('app.debug')).toBe(false);
    });

    it('does not throw for nonexistent keys', () => {
      expect(() => config.forget('nonexistent.key')).not.toThrow();
    });

    it('removes top-level keys', () => {
      config.forget('providers');
      expect(config.has('providers')).toBe(false);
    });
  });

  describe('prepend()', () => {
    it('prepends to an array', () => {
      config.prepend('providers', 'ProviderZ');
      expect(config.get('providers')[0]).toBe('ProviderZ');
    });

    it('creates array if key is missing', () => {
      config.prepend('new.array', 'first');
      expect(config.get('new.array')).toEqual(['first']);
    });

    it('throws if value is not an array', () => {
      expect(() => config.prepend('app.name', 'val')).toThrow('not an array');
    });
  });

  describe('push()', () => {
    it('pushes to an array', () => {
      config.push('providers', 'ProviderC');
      const providers = config.get('providers');
      expect(providers[providers.length - 1]).toBe('ProviderC');
    });

    it('creates array if key is missing', () => {
      config.push('new.list', 'item');
      expect(config.get('new.list')).toEqual(['item']);
    });

    it('throws if value is not an array', () => {
      expect(() => config.push('app.name', 'val')).toThrow('not an array');
    });
  });

  describe('getMany()', () => {
    it('returns values for multiple keys', () => {
      const result = config.getMany(['app.name', 'database.default']);
      expect(result).toEqual({
        'app.name': 'Orchestr',
        'database.default': 'sqlite',
      });
    });

    it('includes undefined for missing keys', () => {
      const result = config.getMany(['app.name', 'missing']);
      expect(result['app.name']).toBe('Orchestr');
      expect(result['missing']).toBeUndefined();
    });
  });

  describe('merge()', () => {
    it('deep merges configuration', () => {
      config.merge({
        app: {
          name: 'Merged',
          extra: 'new',
        },
      });
      expect(config.get('app.name')).toBe('Merged');
      expect(config.get('app.extra')).toBe('new');
      expect(config.get('app.debug')).toBe(true); // preserved
    });

    it('adds new top-level keys', () => {
      config.merge({ cache: { driver: 'array' } });
      expect(config.get('cache.driver')).toBe('array');
    });

    it('overwrites non-object values', () => {
      config.merge({ providers: ['NewProvider'] });
      expect(config.get('providers')).toEqual(['NewProvider']);
    });
  });

  describe('empty config', () => {
    it('works with no initial items', () => {
      const empty = new Config();
      expect(empty.all()).toEqual({});
      expect(empty.has('anything')).toBe(false);
      expect(empty.get('anything', 'default')).toBe('default');
    });
  });
});
