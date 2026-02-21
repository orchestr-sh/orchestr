import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setGlobalApp, getGlobalApp, config, base_path, routes_path, resource_path } from '@/Support/helpers';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';

describe('helpers', () => {
  describe('setGlobalApp() / getGlobalApp()', () => {
    afterEach(() => {
      setGlobalApp(null as any);
    });

    it('sets and gets the global app', () => {
      const app = new Application('/test');
      setGlobalApp(app);
      expect(getGlobalApp()).toBe(app);
    });
  });

  describe('config()', () => {
    let app: Application;

    beforeEach(() => {
      app = new Application('/test');
      const configInstance = new Config({
        app: { name: 'TestApp', debug: true },
      });
      app.instance('config', configInstance);
      setGlobalApp(app);
    });

    afterEach(() => {
      setGlobalApp(null as any);
    });

    it('gets a config value', () => {
      expect(config('app.name')).toBe('TestApp');
    });

    it('gets config with default', () => {
      expect(config('app.missing', 'fallback')).toBe('fallback');
    });

    it('returns config instance when no key', () => {
      const result = config();
      expect(result).toBeInstanceOf(Config);
    });

    it('throws when app not initialized', () => {
      setGlobalApp(null as any);
      expect(() => config('anything')).toThrow('Application not initialized');
    });
  });

  describe('base_path()', () => {
    it('returns cwd', () => {
      expect(base_path()).toBe(process.cwd());
    });

    it('appends path', () => {
      expect(base_path('app')).toBe(`${process.cwd()}/app`);
    });
  });

  describe('routes_path()', () => {
    it('returns routes directory', () => {
      expect(routes_path()).toBe(`${process.cwd()}/routes`);
    });

    it('appends path', () => {
      expect(routes_path('web.ts')).toBe(`${process.cwd()}/routes/web.ts`);
    });
  });

  describe('resource_path()', () => {
    it('returns resources directory', () => {
      expect(resource_path()).toBe(`${process.cwd()}/resources`);
    });

    it('appends path', () => {
      expect(resource_path('views')).toBe(`${process.cwd()}/resources/views`);
    });
  });
});
