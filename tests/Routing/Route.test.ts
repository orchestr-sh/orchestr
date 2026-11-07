import { describe, it, expect, afterEach, vi } from 'vitest';
import { Route } from '@/Routing/Route';

describe('Route', () => {
  afterEach(() => {
    // Global patterns are static and outlive individual routes
    Route.flushPatterns();
  });

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

  describe('middleware()', () => {
    it('adds a single middleware', () => {
      const route = new Route('GET', '/test', () => {});
      const mw = vi.fn();
      route.middleware(mw);
      expect(route.middlewareList).toContain(mw);
    });

    it('adds array of middleware', () => {
      const route = new Route('GET', '/test', () => {});
      const mw1 = vi.fn();
      const mw2 = vi.fn();
      route.middleware([mw1, mw2]);
      expect(route.middlewareList).toContain(mw1);
      expect(route.middlewareList).toContain(mw2);
    });

    it('records alias and group names for dispatch-time resolution', () => {
      const route = new Route('GET', '/test', () => {});
      route.middleware('auth').middleware(['web', 'throttle']);
      expect(route.middlewareList).toEqual(['auth', 'web', 'throttle']);
    });

    it('returns the route for chaining', () => {
      const route = new Route('GET', '/test', () => {});
      const result = route.middleware(vi.fn() as any);
      expect(result).toBe(route);
    });
  });

  describe('withoutMiddleware()', () => {
    it('records excluded middleware by name and reference', () => {
      const route = new Route('GET', '/test', () => {});
      const mw = vi.fn();

      const result = route.withoutMiddleware('auth').withoutMiddleware([mw, 'web']);

      expect(result).toBe(route);
      expect(route.excludedMiddleware).toEqual(['auth', mw, 'web']);
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

  describe('scopeBindings()', () => {
    it('flags the route for scoped model binding', () => {
      const route = new Route('GET', '/users/:user/posts/:post', () => {});
      expect(route.scopedBindings).toBe(false);

      const result = route.scopeBindings();

      expect(route.scopedBindings).toBe(true);
      expect(result).toBe(route);
    });
  });

  describe('parameters after binding', () => {
    it('can hold resolved (non-string) values', () => {
      const route = new Route('GET', '/users/:user', () => {});
      route.bind('/users/1');

      const model = { id: 1, name: 'Ada' };
      route.parameters.user = model;

      expect(route.getParameters().user).toBe(model);
      expect(route.parameter('user')).toBe(model);
    });
  });

  describe('URI normalization', () => {
    it('normalizes the registered URI', () => {
      expect(new Route('GET', 'users/', () => {}).uri).toBe('/users');
      expect(new Route('GET', '//users//', () => {}).uri).toBe('/users');
      expect(new Route('GET', '/', () => {}).uri).toBe('/');
    });

    it('matches paths with trailing slashes', () => {
      const route = new Route('GET', '/users', () => {});
      expect(route.matches('GET', '/users/')).toBe(true);
      expect(route.bind('/users/').id).toBeUndefined();
    });

    it('normalizes request paths before binding', () => {
      const route = new Route('GET', '/users/:id', () => {});
      expect(route.matches('GET', '/users/7/')).toBe(true);
      expect(route.bind('/users/7/')).toEqual({ id: '7' });
    });
  });

  describe('optional parameters', () => {
    const makeRoute = () => new Route('GET', '/users/:id?', () => {});

    it('matches both with and without the segment', () => {
      const route = makeRoute();
      expect(route.matches('GET', '/users')).toBe(true);
      expect(route.matches('GET', '/users/')).toBe(true);
      expect(route.matches('GET', '/users/1')).toBe(true);
      expect(route.matches('GET', '/users/1/2')).toBe(false);
    });

    it('omits the absent optional parameter from the bound bag', () => {
      expect(makeRoute().bind('/users')).toEqual({});
      expect(makeRoute().bind('/users/')).toEqual({});
      expect(makeRoute().bind('/users/1')).toEqual({ id: '1' });
    });

    it('tracks optionality per parameter name', () => {
      const route = new Route('GET', '/pages/:slug?/v:version?', () => {});
      expect(route.isOptionalParameter('slug')).toBe(true);
      expect(route.hasParameter('version')).toBe(true);
    });
  });

  describe('URL decoding', () => {
    it('decodes percent-encoded parameter values', () => {
      const route = new Route('GET', '/users/:name', () => {});
      expect(route.bind('/users/john%20doe')).toEqual({ name: 'john doe' });
      expect(route.bind('/users/%C3%A9t%C3%A9')).toEqual({ name: 'été' });
    });

    it('keeps malformed percent sequences untouched instead of throwing', () => {
      const route = new Route('GET', '/files/:name', () => {});
      expect(route.bind('/files/%zz')).toEqual({ name: '%zz' });
    });
  });

  describe('where()', () => {
    it('constrains matching to the given regex', () => {
      const route = new Route('GET', '/users/:id', () => {}).where('id', '\\d+');

      expect(route.matches('GET', '/users/42')).toBe(true);
      expect(route.matches('GET', '/users/abc')).toBe(false);
    });

    it('keeps parameter names and regex constraints in sync when rebinding', () => {
      const route = new Route('GET', '/users/:id', () => {});
      expect(route.bind('/users/abc')).toEqual({ id: 'abc' });

      route.where('id', '\\d+');
      expect(route.bind('/users/42')).toEqual({ id: '42' });
      expect(route.bind('/users/abc')).toEqual({});
    });

    it('constrains optional segments without breaking their absence', () => {
      const route = new Route('GET', '/users/:id?', () => {}).where('id', '\\d+');

      expect(route.matches('GET', '/users')).toBe(true);
      expect(route.matches('GET', '/users/9')).toBe(true);
      expect(route.matches('GET', '/users/x')).toBe(false);
    });

    it('accepts the array form', () => {
      const route = new Route('GET', '/users/:id/posts/:slug', () => {}).where({
        id: '\\d+',
        slug: '[a-z-]+',
      });

      expect(route.matches('GET', '/users/1/posts/hello-world')).toBe(true);
      expect(route.matches('GET', '/users/1/posts/Hello')).toBe(false);
    });

    it('validates at registration: unknown parameters are rejected', () => {
      const route = new Route('GET', '/users/:id', () => {});
      expect(() => route.where('nope', '\\d+')).toThrow(/does not have a parameter named \[nope\]/);
    });

    it('validates at registration: invalid regexes are rejected', () => {
      const route = new Route('GET', '/users/:id', () => {});
      expect(() => route.where('id', '(')).toThrow(/Invalid regular expression constraint/);
      expect(route.wheres.id).toBeUndefined();
    });

    it('validates at registration: an empty pattern is rejected', () => {
      const route = new Route('GET', '/users/:id', () => {});
      expect(() => route.where('id')).toThrow(/constraint pattern is required/i);
    });

    it('alternations are wrapped so they apply to the whole segment', () => {
      const route = new Route('GET', '/sort/:direction', () => {}).where('direction', 'asc|desc');

      expect(route.matches('GET', '/sort/asc')).toBe(true);
      expect(route.matches('GET', '/sort/desc')).toBe(true);
      expect(route.matches('GET', '/sort/asdesc')).toBe(false);
      expect(route.matches('GET', '/sort/asc/x')).toBe(false);
    });
  });

  describe('Route.pattern()', () => {
    it('constrains every route that declares the named parameter', () => {
      Route.pattern('id', '\\d+');

      const users = new Route('GET', '/users/:id', () => {});
      const posts = new Route('GET', '/posts/:id', () => {});

      expect(users.matches('GET', '/users/5')).toBe(true);
      expect(users.matches('GET', '/users/abc')).toBe(false);
      expect(posts.matches('GET', '/posts/abc')).toBe(false);
    });

    it('recompiles existing routes lazily when a pattern arrives late', () => {
      const route = new Route('GET', '/pages/:slug', () => {});
      expect(route.matches('GET', '/pages/ABC1')).toBe(true);

      Route.pattern('slug', '[a-z]+');

      expect(route.matches('GET', '/pages/ABC1')).toBe(false);
      expect(route.matches('GET', '/pages/welcome')).toBe(true);
    });

    it('route where() takes precedence over the global pattern', () => {
      Route.pattern('id', '[a-z]+');
      const route = new Route('GET', '/users/:id', () => {}).where('id', '\\d+');

      expect(route.matches('GET', '/users/1')).toBe(true);
      expect(route.matches('GET', '/users/abc')).toBe(false);
    });

    it('validates names and regexes', () => {
      expect(() => Route.pattern('9bad', '\\d+')).toThrow(/Invalid route parameter name/);
      expect(() => Route.pattern('id', '(')).toThrow(/Invalid regular expression constraint/);
    });

    it('flushPatterns() removes the constraints again', () => {
      Route.pattern('id', '\\d+');
      const route = new Route('GET', '/users/:id', () => {});
      expect(route.matches('GET', '/users/abc')).toBe(false);

      Route.flushPatterns();

      expect(route.matches('GET', '/users/abc')).toBe(true);
    });
  });

  describe('domain constraints', () => {
    it('matches any host without a domain', () => {
      const route = new Route('GET', '/x', () => {});
      expect(route.matchesDomain()).toBe(true);
      expect(route.matchesDomain('anything.test')).toBe(true);
    });

    it('requires the host when a domain is set', () => {
      const route = new Route('GET', '/x', () => {});
      route.domain = 'example.com';

      expect(route.matchesDomain('example.com')).toBe(true);
      expect(route.matchesDomain('EXAMPLE.com:8080')).toBe(true);
      expect(route.matchesDomain('other.com')).toBe(false);
      expect(route.matchesDomain(undefined)).toBe(false);
    });

    it('binds :params from the host', () => {
      const route = new Route('GET', '/x', () => {});
      route.domain = ':account.example.com';

      expect(route.matchesDomain('acme.example.com')).toBe(true);
      expect(route.bindDomainParameters('acme.example.com')).toEqual({ account: 'acme' });
    });
  });

  describe('clone()', () => {
    it('copies the definition but keeps parameters isolated', () => {
      const original = new Route('GET', '/users/:id', () => {});
      original.setName('users.show');

      const copy = original.clone();
      copy.bind('/users/1');
      copy.parameters.injected = 'mutated';

      expect(original.parameters).toEqual({});
      expect(copy.getParameters()).toEqual({ id: '1', injected: 'mutated' });
      expect(copy.uri).toBe(original.uri);
      expect(copy.name).toBe('users.show');
      expect(copy).not.toBe(original);
    });

    it('carries constraints, domain, middleware and flags', () => {
      const mw = vi.fn();
      const original = new Route(['GET', 'HEAD'], '/users/:id', () => {}).where('id', '\\d+');
      original.domain = 'example.com';
      original.scopeBindings();
      original.isFallback = false;
      original.middleware(mw).withoutMiddleware('auth');

      const copy = original.clone();

      expect(copy.wheres).toEqual({ id: '\\d+' });
      expect(copy.methods).toEqual(['GET', 'HEAD']);
      expect(copy.domain).toBe('example.com');
      expect(copy.scopedBindings).toBe(true);
      expect(copy.middlewareList).toEqual([mw]);
      expect(copy.excludedMiddleware).toEqual(['auth']);

      copy.middleware(vi.fn() as any);
      copy.withoutMiddleware('web');
      expect(original.middlewareList).toHaveLength(1);
      expect(original.excludedMiddleware).toEqual(['auth']);
    });
  });
});
