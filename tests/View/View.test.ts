import { describe, it, expect, vi } from 'vitest';
import { View } from '@/View/View';
import type { ViewEngine } from '@/View/Engines/ViewEngine';

const mockEngine: ViewEngine = {
  get: vi.fn(async (path: string, data: Record<string, any>) => {
    return `<h1>${data.title || 'Default'}</h1>`;
  }),
};

describe('View', () => {
  describe('constructor', () => {
    it('stores engine, name, path, and data', () => {
      const view = new View(mockEngine, 'welcome', '/views/welcome.html', { title: 'Hello' });
      expect(view.name()).toBe('welcome');
      expect(view.getPath()).toBe('/views/welcome.html');
      expect(view.getData()).toEqual({ title: 'Hello' });
    });

    it('defaults data to empty object', () => {
      const view = new View(mockEngine, 'test', '/test.html');
      expect(view.getData()).toEqual({});
    });
  });

  describe('with()', () => {
    it('adds a single data key', () => {
      const view = new View(mockEngine, 'test', '/test.html');
      view.with('name', 'John');
      expect(view.getData()).toEqual({ name: 'John' });
    });

    it('adds multiple data keys from object', () => {
      const view = new View(mockEngine, 'test', '/test.html');
      view.with({ a: 1, b: 2 });
      expect(view.getData()).toEqual({ a: 1, b: 2 });
    });

    it('returns the view for chaining', () => {
      const view = new View(mockEngine, 'test', '/test.html');
      expect(view.with('key', 'val')).toBe(view);
    });
  });

  describe('render()', () => {
    it('calls engine.get with path and data', async () => {
      const view = new View(mockEngine, 'welcome', '/views/welcome.html', { title: 'Test' });
      const html = await view.render();
      expect(mockEngine.get).toHaveBeenCalledWith('/views/welcome.html', { title: 'Test' });
      expect(html).toBe('<h1>Test</h1>');
    });
  });

  describe('toHtml()', () => {
    it('is an alias for render()', async () => {
      const view = new View(mockEngine, 'test', '/test.html', { title: 'Alias' });
      const html = await view.toHtml();
      expect(html).toBe('<h1>Alias</h1>');
    });
  });

  describe('toString()', () => {
    it('returns debug string', () => {
      const view = new View(mockEngine, 'welcome', '/test.html');
      expect(view.toString()).toBe('[View: welcome]');
    });
  });
});
