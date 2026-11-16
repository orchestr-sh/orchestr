import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ViewEngine } from '@/View/Engines/ViewEngine';
import { View } from '@/View/View';
import { ViewFactory } from '@/View/ViewFactory';
import { createViewSetup, type ViewTestSetup } from './support';

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

describe('ViewFactory composers, creators and lookup helpers', () => {
  let setup: ViewTestSetup;

  beforeEach(() => {
    setup = createViewSetup({ cache: false });
    setup.put('welcome', '<h1>{{ title }}</h1>');
    setup.put('posts.index', '<ol>{{ count }}</ol>');
    setup.put('posts.show', '<article>{{ post }}</article>');
    setup.put('users.index', '<p>{{ name }}</p>');
  });

  afterEach(() => {
    setup.cleanup();
  });

  describe('composer()', () => {
    it('runs for matching views on every render', async () => {
      const seen = vi.fn();
      setup.factory.composer('welcome', (view) => {
        seen();
        view.with('title', 'Composed');
      });

      const html = await setup.factory.make('welcome').render();
      expect(seen).toHaveBeenCalledTimes(1);
      expect(html).toBe('<h1>Composed</h1>');

      // Composers fire again on a later render of the same view name.
      await setup.factory.make('welcome').render();
      expect(seen).toHaveBeenCalledTimes(2);
    });

    it('supports wildcard patterns like posts.*', async () => {
      setup.factory.composer('posts.*', (view) => {
        view.with('count', 42).with('post', 'Hello');
      });

      expect(await setup.factory.make('posts.index').render()).toBe('<ol>42</ol>');
      expect(await setup.factory.make('posts.show').render()).toBe('<article>Hello</article>');
      // Unrelated views are untouched.
      expect(await setup.factory.make('users.index', { name: 'x' }).render()).toBe('<p>x</p>');
    });

    it('supports "*" and arrays of patterns', async () => {
      setup.factory.composer(['*'], (view) => {
        view.with('name', 'shared-by-star');
      });

      expect(await setup.factory.make('users.index').render()).toBe('<p>shared-by-star</p>');
    });

    it('can be async', async () => {
      setup.factory.composer('users.index', async (view) => {
        await Promise.resolve();
        view.with('name', 'Async');
      });

      expect(await setup.factory.make('users.index').render()).toBe('<p>Async</p>');
    });
  });

  describe('creator()', () => {
    it('runs once at make() time, not on renders', async () => {
      const seen = vi.fn();
      setup.factory.creator('welcome', (view) => {
        seen();
        view.with('title', 'Created');
      });

      const view = setup.factory.make('welcome');
      expect(seen).toHaveBeenCalledTimes(1);
      await view.render();
      await view.render();

      expect(seen).toHaveBeenCalledTimes(1);
      expect(await setup.factory.make('welcome').render()).toBe('<h1>Created</h1>');
    });
  });

  describe('first()', () => {
    it('returns the first view that exists', async () => {
      const view = setup.factory.first(['emails.missing', 'users.index'], { name: 'Ada' });
      expect(view.name()).toBe('users.index');
      expect(await view.render()).toBe('<p>Ada</p>');
    });

    it('throws when none of the views exist', () => {
      expect(() => setup.factory.first(['nope.a', 'nope.b'])).toThrow('None of the views');
    });
  });

  describe('directive()', () => {
    it('registers custom directives on the compiler engine', async () => {
      setup.factory.directive('greet', (args, ctx) => `Hello ${ctx.escape(args)}`);
      setup.put('custom', '@greet(Ada)');

      expect(await setup.factory.make('custom').render()).toBe('Hello Ada');
    });

    it('throws when the engine cannot register directives', () => {
      const plainFactory = new ViewFactory({ get: async () => '' } as ViewEngine, []);
      expect(() => plainFactory.directive('x', () => '')).toThrow(/does not support custom directives/);
    });
  });

  describe('getEngine()', () => {
    it('exposes the configured engine', () => {
      expect(setup.factory.getEngine()).toBe(setup.engine);
    });
  });
});
