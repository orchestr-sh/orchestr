import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ViewFactory } from '@/View/ViewFactory';
import { View } from '@/View/View';
import type { ViewEngine } from '@/View/Engines/ViewEngine';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockEngine: ViewEngine = {
  get: async (_path: string, _data: Record<string, any>) => '<html></html>',
};

describe('ViewFactory', () => {
  let viewDir: string;
  let factory: ViewFactory;

  beforeEach(() => {
    viewDir = join(tmpdir(), `orchestr-test-views-${Date.now()}`);
    mkdirSync(viewDir, { recursive: true });
    mkdirSync(join(viewDir, 'layouts'), { recursive: true });
    mkdirSync(join(viewDir, 'emails'), { recursive: true });

    writeFileSync(join(viewDir, 'welcome.html'), '<h1>Welcome</h1>');
    writeFileSync(join(viewDir, 'layouts', 'app.html'), '<html>@yield("content")</html>');
    writeFileSync(join(viewDir, 'emails', 'invoice.html'), '<p>Invoice</p>');

    factory = new ViewFactory(mockEngine, [viewDir]);
  });

  afterEach(() => {
    if (existsSync(viewDir)) {
      rmSync(viewDir, { recursive: true });
    }
  });

  describe('make()', () => {
    it('creates a View instance', () => {
      const view = factory.make('welcome');
      expect(view).toBeInstanceOf(View);
    });

    it('resolves dot-notation names', () => {
      const view = factory.make('layouts.app');
      expect(view.getPath()).toBe(join(viewDir, 'layouts', 'app.html'));
    });

    it('merges shared data with view data', () => {
      factory.share('appName', 'Orchestr');
      const view = factory.make('welcome', { page: 'home' });
      expect(view.getData()).toEqual({ appName: 'Orchestr', page: 'home' });
    });

    it('view data overrides shared data', () => {
      factory.share('title', 'Default');
      const view = factory.make('welcome', { title: 'Custom' });
      expect(view.getData().title).toBe('Custom');
    });
  });

  describe('exists()', () => {
    it('returns true for existing views', () => {
      expect(factory.exists('welcome')).toBe(true);
    });

    it('returns true for nested views', () => {
      expect(factory.exists('emails.invoice')).toBe(true);
    });

    it('returns false for missing views', () => {
      expect(factory.exists('nonexistent')).toBe(false);
    });
  });

  describe('share()', () => {
    it('shares data with string key', () => {
      factory.share('key', 'value');
      expect(factory.getShared()).toEqual({ key: 'value' });
    });

    it('shares data with object', () => {
      factory.share({ a: 1, b: 2 });
      expect(factory.getShared()).toEqual({ a: 1, b: 2 });
    });
  });

  describe('addLocation()', () => {
    it('adds a new view path', () => {
      factory.addLocation('/extra/views');
      expect(factory.getPaths()).toContain('/extra/views');
    });
  });

  describe('findView()', () => {
    it('resolves a view name to path', () => {
      const path = factory.findView('welcome');
      expect(path).toBe(join(viewDir, 'welcome.html'));
    });

    it('throws for non-existent views', () => {
      expect(() => factory.findView('missing')).toThrow('View [missing] not found');
    });
  });
});
