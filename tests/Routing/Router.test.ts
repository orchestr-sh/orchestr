import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Router } from '@/Routing/Router';
import { Application } from '@/Foundation/Application';

describe('Router', () => {
  let app: Application;
  let router: Router;

  beforeEach(() => {
    app = new Application('/test');
    router = new Router(app);
  });

  describe('HTTP method registration', () => {
    it('registers GET routes', () => {
      router.get('/users', () => {});
      const route = router.findRoute('GET', '/users');
      expect(route).not.toBeNull();
    });

    it('GET also matches HEAD', () => {
      router.get('/users', () => {});
      const route = router.findRoute('HEAD', '/users');
      expect(route).not.toBeNull();
    });

    it('registers POST routes', () => {
      router.post('/users', () => {});
      expect(router.findRoute('POST', '/users')).not.toBeNull();
    });

    it('registers PUT routes', () => {
      router.put('/users/:id', () => {});
      expect(router.findRoute('PUT', '/users/1')).not.toBeNull();
    });

    it('registers PATCH routes', () => {
      router.patch('/users/:id', () => {});
      expect(router.findRoute('PATCH', '/users/1')).not.toBeNull();
    });

    it('registers DELETE routes', () => {
      router.delete('/users/:id', () => {});
      expect(router.findRoute('DELETE', '/users/1')).not.toBeNull();
    });

    it('registers ANY routes', () => {
      router.any('/health', () => {});
      expect(router.findRoute('GET', '/health')).not.toBeNull();
      expect(router.findRoute('POST', '/health')).not.toBeNull();
      expect(router.findRoute('PUT', '/health')).not.toBeNull();
      expect(router.findRoute('DELETE', '/health')).not.toBeNull();
    });

    it('registers match routes with specific methods', () => {
      router.match(['GET', 'POST'], '/search', () => {});
      expect(router.findRoute('GET', '/search')).not.toBeNull();
      expect(router.findRoute('POST', '/search')).not.toBeNull();
      expect(router.findRoute('DELETE', '/search')).toBeNull();
    });
  });

  describe('findRoute()', () => {
    it('returns null for unmatched routes', () => {
      expect(router.findRoute('GET', '/nonexistent')).toBeNull();
    });

    it('binds parameters on match', () => {
      router.get('/users/:id', () => {});
      const route = router.findRoute('GET', '/users/42');
      expect(route!.getParameters()).toEqual({ id: '42' });
    });
  });

  describe('group()', () => {
    it('applies prefix to routes in group', () => {
      router.group({ prefix: 'api' }, () => {
        router.get('/users', () => {});
      });
      expect(router.findRoute('GET', '/api/users')).not.toBeNull();
    });

    it('applies middleware to routes in group', () => {
      const middleware = vi.fn();
      router.group({ middleware }, () => {
        router.get('/protected', () => {});
      });
      const route = router.findRoute('GET', '/protected');
      expect(route!.middleware).toContain(middleware);
    });

    it('applies array middleware to routes', () => {
      const mw1 = vi.fn();
      const mw2 = vi.fn();
      router.group({ middleware: [mw1, mw2] }, () => {
        router.get('/test', () => {});
      });
      const route = router.findRoute('GET', '/test');
      expect(route!.middleware).toContain(mw1);
      expect(route!.middleware).toContain(mw2);
    });

    it('supports nested groups', () => {
      router.group({ prefix: 'api' }, () => {
        router.group({ prefix: 'v1' }, () => {
          router.get('/users', () => {});
        });
      });
      expect(router.findRoute('GET', '/api/v1/users')).not.toBeNull();
    });

    it('group scope does not leak', () => {
      router.group({ prefix: 'api' }, () => {
        router.get('/inside', () => {});
      });
      router.get('/outside', () => {});
      expect(router.findRoute('GET', '/api/inside')).not.toBeNull();
      expect(router.findRoute('GET', '/outside')).not.toBeNull();
      expect(router.findRoute('GET', '/api/outside')).toBeNull();
    });
  });

  describe('named routes', () => {
    it('registers and retrieves named routes', () => {
      const route = router.get('/users', () => {});
      router.name('users.index', route);
      expect(router.getByName('users.index')).toBe(route);
    });

    it('returns undefined for unknown names', () => {
      expect(router.getByName('nonexistent')).toBeUndefined();
    });
  });

  describe('getRoutes()', () => {
    it('returns all registered routes', () => {
      router.get('/a', () => {});
      router.post('/b', () => {});
      expect(router.getRoutes()).toHaveLength(2);
    });
  });
});
