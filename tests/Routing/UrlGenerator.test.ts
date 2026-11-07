/**
 * UrlGenerator - named-route URL generation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Route } from '@/Routing/Route';
import { UrlGenerator } from '@/Routing/UrlGenerator';

describe('UrlGenerator', () => {
  let routes: Map<string, Route>;
  let generator: UrlGenerator;

  beforeEach(() => {
    routes = new Map();
    generator = new UrlGenerator(() => routes);
  });

  function register(name: string, uri: string, configure?: (route: Route) => void): Route {
    const route = new Route(['GET', 'HEAD'], uri, () => {});
    route.setName(name);

    if (configure) {
      configure(route);
    }

    routes.set(name, route);
    return route;
  }

  describe('placeholder replacement', () => {
    it('replaces :param placeholders from a record', () => {
      register('users.show', '/users/:id');
      expect(generator.route('users.show', { id: 1 })).toBe('/users/1');

      register('users.posts.show', '/users/:user/posts/:post');
      expect(generator.route('users.posts.show', { user: 1, post: 22 })).toBe('/users/1/posts/22');
    });

    it('binds a scalar to the first declared parameter', () => {
      register('users.show', '/users/:id');
      expect(generator.route('users.show', 5)).toBe('/users/5');
    });

    it('binds array elements positionally', () => {
      register('users.posts.show', '/users/:user/posts/:post');
      expect(generator.route('users.posts.show', [1, 2])).toBe('/users/1/posts/2');
    });

    it('resolves models through getRouteKey()', () => {
      register('users.show', '/users/:id');

      const model = { getRouteKey: () => 42 };
      expect(generator.route('users.show', model as never)).toBe('/users/42');
      expect(generator.route('users.show', { id: model })).toBe('/users/42');
    });

    it('drops absent optional segments but keeps provided ones', () => {
      register('users.index', '/users/:id?');

      expect(generator.route('users.index')).toBe('/users');
      expect(generator.route('users.index', { id: 3 })).toBe('/users/3');
    });

    it('encodes parameter values', () => {
      register('users.show', '/users/:name');

      expect(generator.route('users.show', { name: 'john doe' })).toBe('/users/john%20doe');
      expect(generator.route('users.show', { name: 'a/b' })).toBe('/users/a%2Fb');
    });

    it('serves the root route as "/"', () => {
      register('home', '/');
      expect(generator.route('home')).toBe('/');
    });

    it('throws when a required parameter is missing', () => {
      register('users.show', '/users/:id');
      expect(() => generator.route('users.show')).toThrow(/missing required parameter \[id\]/);
    });

    it('throws for undefined route names', () => {
      expect(() => generator.route('ghost')).toThrow(/Route \[ghost\] not defined/);
    });
  });

  describe('query string', () => {
    it('appends unused parameters as a query string', () => {
      register('users.show', '/users/:id');

      expect(generator.route('users.show', { id: 1, page: 2 })).toBe('/users/1?page=2');
      expect(generator.route('users.show', { id: 1, page: 2, sort: 'name' })).toBe('/users/1?page=2&sort=name');
    });

    it('serializes lists with indexed keys', () => {
      register('users.show', '/users/:id');

      expect(generator.route('users.show', { id: 1, tags: ['a', 'b'] })).toBe('/users/1?tags%5B0%5D=a&tags%5B1%5D=b');
    });

    it('serializes nested objects with bracket keys', () => {
      register('users.show', '/users/:id');

      expect(generator.route('users.show', { id: 1, filter: { status: 'active' } })).toBe(
        '/users/1?filter%5Bstatus%5D=active'
      );
    });

    it('emits empty values for null parameters', () => {
      register('users.show', '/users/:id');

      expect(generator.route('users.show', { id: 1, flag: null })).toBe('/users/1?flag=');
    });

    it('leaves array leftovers in the query string', () => {
      register('users.show', '/users/:id');

      expect(generator.route('users.show', [5, 'leftover'])).toBe('/users/5?1=leftover');
    });
  });

  describe('domain support', () => {
    it('prefixes the generated path with the route domain', () => {
      register('users.show', '/users/:id', (route) => {
        route.domain = 'example.com';
      });

      expect(generator.route('users.show', { id: 1 })).toBe('http://example.com/users/1');
    });

    it('fills :params in the domain and consumes them', () => {
      register('dashboard', '/dashboard', (route) => {
        route.domain = ':account.example.com';
      });

      expect(generator.route('dashboard', { account: 'acme' })).toBe('http://acme.example.com/dashboard');
      expect(generator.route('dashboard', { account: 'acme', ref: 'nav' })).toBe(
        'http://acme.example.com/dashboard?ref=nav'
      );
    });

    it('throws when a required domain parameter is missing', () => {
      register('dashboard', '/dashboard', (route) => {
        route.domain = ':account.example.com';
      });

      expect(() => generator.route('dashboard')).toThrow(/missing required parameter \[account\]/);
    });
  });

  describe('group prefixes', () => {
    it('generates from the composed (group prefixed) URI', () => {
      // Routers compose the prefix into the route URI before naming; the
      // generator simply fills the stored URI.
      const route = register('v1.users.show', '/api/v1/users/:id');
      expect(generator.route('v1.users.show', { id: 9 })).toBe('/api/v1/users/9');
      expect(route.uri).toBe('/api/v1/users/:id');
    });
  });
});
