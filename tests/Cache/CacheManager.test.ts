import { describe, it, expect, beforeEach } from 'vitest';
import { CacheManager } from '@/Cache/CacheManager';
import { ArrayStore } from '@/Cache/Stores/ArrayStore';
import { NullStore } from '@/Cache/Stores/NullStore';

describe('CacheManager', () => {
  let manager: CacheManager;

  beforeEach(() => {
    manager = new CacheManager({
      default: 'array',
      prefix: 'app_',
      stores: {
        array: { driver: 'array' },
        null: { driver: 'null' },
      },
    });

    manager.registerDriver('array', (config) => new ArrayStore(config));
    manager.registerDriver('null', () => new NullStore());
  });

  describe('store()', () => {
    it('returns default store', () => {
      const repo = manager.store();
      expect(repo).toBeDefined();
    });

    it('returns named store', () => {
      const repo = manager.store('null');
      expect(repo).toBeDefined();
    });

    it('caches store instances', () => {
      const a = manager.store();
      const b = manager.store();
      expect(a).toBe(b);
    });

    it('throws for unconfigured store', () => {
      expect(() => manager.store('redis')).toThrow('Cache store [redis] not configured');
    });

    it('throws for unregistered driver', () => {
      const mgr = new CacheManager({
        default: 'custom',
        prefix: '',
        stores: { custom: { driver: 'custom' } },
      });
      expect(() => mgr.store()).toThrow('Cache driver [custom] not registered');
    });
  });

  describe('registerDriver() / extend()', () => {
    it('registers a custom driver', () => {
      manager.registerDriver('custom', () => new ArrayStore());
      const mgr = new CacheManager({
        default: 'custom',
        prefix: '',
        stores: { custom: { driver: 'custom' } },
      });
      mgr.registerDriver('custom', () => new ArrayStore());
      expect(mgr.store()).toBeDefined();
    });

    it('extend() is an alias for registerDriver()', () => {
      manager.extend('custom', () => new ArrayStore());
      // extend just calls registerDriver internally
      const mgr = new CacheManager({
        default: 'test',
        prefix: '',
        stores: { test: { driver: 'custom' } },
      });
      mgr.extend('custom', () => new ArrayStore());
      expect(mgr.store()).toBeDefined();
    });
  });

  describe('default driver', () => {
    it('getDefaultDriver() returns configured default', () => {
      expect(manager.getDefaultDriver()).toBe('array');
    });

    it('setDefaultDriver() changes default', () => {
      manager.setDefaultDriver('null');
      expect(manager.getDefaultDriver()).toBe('null');
    });
  });

  describe('getPrefix()', () => {
    it('returns configured prefix', () => {
      expect(manager.getPrefix()).toBe('app_');
    });
  });

  describe('getStoreNames()', () => {
    it('returns all configured store names', () => {
      expect(manager.getStoreNames()).toEqual(['array', 'null']);
    });
  });

  describe('getStoreConfig()', () => {
    it('returns config for named store', () => {
      const config = manager.getStoreConfig('array');
      expect(config.driver).toBe('array');
    });

    it('returns default store config when no name', () => {
      expect(manager.getStoreConfig().driver).toBe('array');
    });

    it('throws for unconfigured store', () => {
      expect(() => manager.getStoreConfig('redis')).toThrow('not configured');
    });
  });

  describe('getConfig()', () => {
    it('returns full configuration', () => {
      const config = manager.getConfig();
      expect(config.default).toBe('array');
      expect(config.stores).toHaveProperty('array');
      expect(config.stores).toHaveProperty('null');
    });
  });

  describe('purge()', () => {
    it('removes cached store instance', () => {
      const a = manager.store();
      manager.purge();
      const b = manager.store();
      expect(a).not.toBe(b);
    });

    it('purges specific store', () => {
      const a = manager.store('null');
      manager.purge('null');
      const b = manager.store('null');
      expect(a).not.toBe(b);
    });
  });

  describe('purgeAll()', () => {
    it('removes all cached store instances', () => {
      const arr = manager.store('array');
      const nul = manager.store('null');
      manager.purgeAll();
      expect(manager.store('array')).not.toBe(arr);
      expect(manager.store('null')).not.toBe(nul);
    });
  });

  describe('proxy methods', () => {
    it('get() proxies to default store', async () => {
      await manager.put('key', 'value', 3600);
      expect(await manager.get('key')).toBe('value');
    });

    it('has() proxies to default store', async () => {
      await manager.put('key', 'value', 3600);
      expect(await manager.has('key')).toBe(true);
    });

    it('forget() proxies to default store', async () => {
      await manager.put('key', 'value', 3600);
      await manager.forget('key');
      expect(await manager.has('key')).toBe(false);
    });

    it('flush() proxies to default store', async () => {
      await manager.put('a', 1, 3600);
      await manager.flush();
      expect(await manager.has('a')).toBe(false);
    });

    it('remember() proxies to default store', async () => {
      const result = await manager.remember('key', 3600, () => 'computed');
      expect(result).toBe('computed');
    });

    it('rememberForever() proxies to default store', async () => {
      const result = await manager.rememberForever('key', () => 'forever');
      expect(result).toBe('forever');
    });

    it('forever() proxies to default store', async () => {
      await manager.forever('key', 'val');
      expect(await manager.get('key')).toBe('val');
    });

    it('pull() proxies to default store', async () => {
      await manager.put('key', 'val', 3600);
      const result = await manager.pull('key');
      expect(result).toBe('val');
      expect(await manager.has('key')).toBe(false);
    });

    it('many() proxies to default store', async () => {
      await manager.put('a', 1, 3600);
      const result = await manager.many(['a', 'b']);
      expect(result.a).toBe(1);
    });

    it('putMany() proxies to default store', async () => {
      await manager.putMany({ x: 10 }, 3600);
      expect(await manager.get('x')).toBe(10);
    });

    it('add() proxies to default store', async () => {
      expect(await manager.add('key', 'val', 3600)).toBe(true);
      expect(await manager.add('key', 'other', 3600)).toBe(false);
    });

    it('increment() / decrement() proxy to default store', async () => {
      await manager.put('c', 5, 3600);
      await manager.increment('c', 3);
      expect(await manager.get('c')).toBe(8);
      await manager.decrement('c', 2);
      expect(await manager.get('c')).toBe(6);
    });
  });
});
