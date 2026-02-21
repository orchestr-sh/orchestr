import { describe, it, expect, vi } from 'vitest';
import { Route } from '@/Routing/Route';

describe('Route', () => {
  describe('constructor', () => {
    it('normalizes single method to array', () => {
      const route = new Route('GET', '/test', () => {});
      expect(route.methods).toEqual(['GET']);
    });

    it('accepts array of methods', () => {
      const route = new Route(['GET', 'POST'], '/test', () => {});
      expect(route.methods).toEqual(['GET', 'POST']);
    });
  });

  describe('matches()', () => {
    it('matches exact paths', () => {
      const route = new Route('GET', '/users', () => {});
      expect(route.matches('GET', '/users')).toBe(true);
    });

    it('rejects wrong method', () => {
      const route = new Route('GET', '/users', () => {});
      expect(route.matches('POST', '/users')).toBe(false);
    });

    it('rejects wrong path', () => {
      const route = new Route('GET', '/users', () => {});
      expect(route.matches('GET', '/posts')).toBe(false);
    });

    it('matches route parameters', () => {
      const route = new Route('GET', '/users/:id', () => {});
      expect(route.matches('GET', '/users/123')).toBe(true);
      expect(route.matches('GET', '/users/abc')).toBe(true);
    });

    it('matches multiple parameters', () => {
      const route = new Route('GET', '/users/:userId/posts/:postId', () => {});
      expect(route.matches('GET', '/users/1/posts/42')).toBe(true);
    });

    it('rejects partial path matches', () => {
      const route = new Route('GET', '/users', () => {});
      expect(route.matches('GET', '/users/extra')).toBe(false);
    });
  });

  describe('bind()', () => {
    it('extracts parameter values', () => {
      const route = new Route('GET', '/users/:id', () => {});
      route.bind('/users/42');
      expect(route.getParameters()).toEqual({ id: '42' });
    });

    it('extracts multiple parameters', () => {
      const route = new Route('GET', '/users/:userId/posts/:postId', () => {});
      route.bind('/users/1/posts/99');
      expect(route.getParameters()).toEqual({ userId: '1', postId: '99' });
    });
  });

  describe('parameter()', () => {
    it('returns specific parameter value', () => {
      const route = new Route('GET', '/users/:id', () => {});
      route.bind('/users/5');
      expect(route.parameter('id')).toBe('5');
    });

    it('returns default for missing parameter', () => {
      const route = new Route('GET', '/users/:id', () => {});
      route.bind('/users/5');
      expect(route.parameter('name', 'unknown')).toBe('unknown');
    });
  });

  describe('addMiddleware()', () => {
    it('adds a single middleware', () => {
      const route = new Route('GET', '/test', () => {});
      const mw = vi.fn();
      route.addMiddleware(mw);
      expect(route.middleware).toContain(mw);
    });

    it('adds array of middleware', () => {
      const route = new Route('GET', '/test', () => {});
      const mw1 = vi.fn();
      const mw2 = vi.fn();
      route.addMiddleware([mw1, mw2]);
      expect(route.middleware).toContain(mw1);
      expect(route.middleware).toContain(mw2);
    });

    it('returns the route for chaining', () => {
      const route = new Route('GET', '/test', () => {});
      const result = route.addMiddleware(vi.fn());
      expect(result).toBe(route);
    });
  });

  describe('setName()', () => {
    it('sets the route name', () => {
      const route = new Route('GET', '/users', () => {});
      route.setName('users.index');
      expect(route.name).toBe('users.index');
    });

    it('returns the route for chaining', () => {
      const route = new Route('GET', '/test', () => {});
      const result = route.setName('test');
      expect(result).toBe(route);
    });
  });
});
