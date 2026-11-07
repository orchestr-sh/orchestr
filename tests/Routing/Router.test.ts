import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Application } from '@/Foundation/Application';
import { Request } from '@/Routing/Request';
import { Response } from '@/Routing/Response';
import { Route } from '@/Routing/Route';
import { Router } from '@/Routing/Router';
import { route } from '@/Support/helpers';
import { View } from '@/View/View';

describe('Router', () => {
  let app: Application;
  let router: Router;

  beforeEach(() => {
    app = new Application('/test');
    router = new Router(app);
  });

  afterEach(() => {
    Route.flushPatterns();
  });

  // -------------------------------------------------------------------------
  // Dispatch harness - fake IncomingMessage/ServerResponse plumbing
  // -------------------------------------------------------------------------

  function createRawRequest(method: string, url: string, headers: Record<string, string> = {}): IncomingMessage {
    const req = new IncomingMessage(new Socket());
    req.method = method;
    req.url = url;
    req.headers = headers;
    return req;
  }

  interface DispatchResult {
    status: number;
    body: string;
    json: () => any;
    headers: Record<string, string>;
  }

  async function dispatch(method: string, url: string, headers: Record<string, string> = {}): Promise<DispatchResult> {
    const request = new Request(createRawRequest(method, url, headers));

    const raw = new ServerResponse(request.raw);
    const chunks: string[] = [];
    const sentHeaders: Record<string, string> = {};
    raw.end = ((data?: any) => {
      if (data !== undefined && data !== null) {
        chunks.push(String(data));
      }
    }) as any;
    raw.setHeader = ((name: string, value: any) => {
      sentHeaders[name] = String(value);
    }) as any;

    const response = new Response(raw);
    await router.dispatch(request, response);

    return {
      status: raw.statusCode,
      body: chunks.join(''),
      json: () => JSON.parse(chunks.join('')),
      headers: sentHeaders,
    };
  }

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
      expect(route!.middlewareList).toContain(middleware);
    });

    it('applies array middleware to routes', () => {
      const mw1 = vi.fn();
      const mw2 = vi.fn();
      router.group({ middleware: [mw1, mw2] }, () => {
        router.get('/test', () => {});
      });
      const route = router.findRoute('GET', '/test');
      expect(route!.middlewareList).toContain(mw1);
      expect(route!.middlewareList).toContain(mw2);
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

  describe('route binding', () => {
    it('exposes the shared route resolver', () => {
      expect(router.getRouteResolver()).toBeDefined();
      expect(router.getRouteResolver()).toBe(router.getRouteResolver());
    });

    it('bind() registers an explicit substitution applied on dispatch', async () => {
      router.bind('token', (value) => `bound:${value}`);
      router.get('/tokens/:token', () => {});

      const route = router.findRoute('GET', '/tokens/xyz')!;
      await router.getRouteResolver().substituteBindings(route);

      expect(route.parameters.token).toBe('bound:xyz');
    });

    it('model() rejects non-model classes', () => {
      expect(() => router.model('thing', String as never)).toThrow(/Ensemble model class/);
    });

    it('scopeBindings() flags the most recently registered route', () => {
      const route = router.get('/users/:user/posts/:post', () => {});
      router.scopeBindings();
      expect(route.scopedBindings).toBe(true);
    });

    it('scopeBindings() inside a group applies to routes registered afterwards', () => {
      let scoped: any;
      let unscoped: any;

      router.group({ prefix: 'api' }, () => {
        unscoped = router.get('/before', () => {});
        router.scopeBindings();
        scoped = router.get('/users/:user/posts/:post', () => {});
      });

      expect(scoped.scopedBindings).toBe(true);
      expect(unscoped.scopedBindings).toBe(false);
    });
  });

  describe('compilation parity via findRoute()', () => {
    it('matches optional segments with and without the value', () => {
      router.get('/users/:id?', () => {});

      expect(router.findRoute('GET', '/users')).not.toBeNull();
      expect(router.findRoute('GET', '/users/')).not.toBeNull();
      expect(router.findRoute('GET', '/users/1')!.getParameters()).toEqual({ id: '1' });
      expect(router.findRoute('GET', '/users')!.getParameters()).toEqual({});
    });

    it('normalizes trailing slashes on incoming paths', () => {
      router.get('/about', () => {});
      expect(router.findRoute('GET', '/about/')).not.toBeNull();
    });

    it('URL-decodes bound parameter values', () => {
      router.get('/users/:name', () => {});
      expect(router.findRoute('GET', '/users/john%20doe')!.getParameters()).toEqual({ name: 'john doe' });
    });

    it('rejects paths that violate a route where() constraint', () => {
      router.get('/users/:id', () => {}).where('id', '\\d+');

      expect(router.findRoute('GET', '/users/42')!.getParameters()).toEqual({ id: '42' });
      expect(router.findRoute('GET', '/users/abc')).toBeNull();
    });

    it('applies Router.pattern() constraints globally', () => {
      router.pattern('id', '\\d+');
      router.get('/posts/:id', () => {});

      expect(router.findRoute('GET', '/posts/7')).not.toBeNull();
      expect(router.findRoute('GET', '/posts/seven')).toBeNull();
    });

    it('recompiles previously registered routes when a pattern arrives late', () => {
      router.get('/pages/:slug', () => {});
      expect(router.findRoute('GET', '/pages/ABC1')).not.toBeNull();

      router.pattern('slug', '[a-z]+');

      expect(router.findRoute('GET', '/pages/ABC1')).toBeNull();
      expect(router.findRoute('GET', '/pages/welcome')).not.toBeNull();
    });

    it('validates where() constraints at registration time', () => {
      const route = router.get('/users/:id', () => {});

      expect(() => route.where('missing', '\\d+')).toThrow(/does not have a parameter named/);
      expect(() => route.where('id', '(unclosed')).toThrow(/Invalid regular expression constraint/);
    });

    it('Router.where() constrains the most recently registered route', () => {
      router.get('/users/:id', () => {});
      router.where('id', '\\d+');

      expect(router.findRoute('GET', '/users/42')).not.toBeNull();
      expect(router.findRoute('GET', '/users/abc')).toBeNull();
    });
  });

  describe('fallback()', () => {
    it('catches GET requests that nothing else matched, consulting it last', () => {
      const known = () => {};
      const fallbackAction = () => {};
      router.get('/known', known);
      router.fallback(fallbackAction);

      const matched = router.findRoute('GET', '/deep/path')!;
      expect(matched.action).toBe(fallbackAction);
      expect(matched.name).toBe('fallback');
      expect(matched.parameters.fallback).toBe('deep/path');

      // Registered routes keep priority even when the fallback came first
      expect(router.findRoute('GET', '/known')!.action).toBe(known);
    });

    it('serves GET/HEAD only, leaving other verbs to 404', () => {
      router.fallback(() => {});

      expect(router.findRoute('GET', '/nope')).not.toBeNull();
      expect(router.findRoute('HEAD', '/nope')).not.toBeNull();
      expect(router.findRoute('POST', '/nope')).toBeNull();
    });

    it('dispatches unmatched requests through the fallback action', async () => {
      router.fallback(() => ({ fell: 'back' }));

      const res = await dispatch('GET', '/nowhere');

      expect(res.status).toBe(200);
      expect(res.json()).toEqual({ fell: 'back' });

      const post = await dispatch('POST', '/nowhere');
      expect(post.status).toBe(404);
    });
  });

  describe('method mismatch (405) and OPTIONS', () => {
    it('returns 405 with an Allow header when the path matches but the method does not', async () => {
      router.get('/topics', () => {});
      router.post('/topics', () => {});

      const res = await dispatch('PUT', '/topics');

      expect(res.status).toBe(405);
      expect(res.headers['Allow']).toBe('GET, HEAD, POST');
      expect(res.body).toBe('Method Not Allowed');
    });

    it('answers OPTIONS for an existing path with the Allow header', async () => {
      router.get('/topics', () => {});
      router.post('/topics', () => {});

      const res = await dispatch('OPTIONS', '/topics');

      expect(res.status).toBe(204);
      expect(res.headers['Allow']).toBe('GET, HEAD, POST');
    });

    it('dispatches OPTIONS to routes that register it explicitly', async () => {
      router.match(['OPTIONS'], '/preflight', () => ({ ok: true }));

      const res = await dispatch('OPTIONS', '/preflight');

      expect(res.status).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it('404s paths no route claims', async () => {
      router.get('/topics', () => {});

      const res = await dispatch('PUT', '/ghost');

      expect(res.status).toBe(404);
      expect(res.headers['Allow']).toBeUndefined();
    });

    it('ignores fallback routes when computing allowed methods', async () => {
      router.fallback(() => {});
      router.get('/topics', () => {});

      const res = await dispatch('PUT', '/topics');

      expect(res.status).toBe(405);
      expect(res.headers['Allow']).toBe('GET, HEAD');
    });
  });

  describe('current() / currentRouteName()', () => {
    it('exposes the dispatching route inside the action', async () => {
      let seenParameter: any = null;
      let seenName: string | null = null;

      const route = router.get('/users/:id', () => {
        seenParameter = router.current()?.parameter('id');
        seenName = router.currentRouteName();
      });
      router.name('users.show', route);

      await dispatch('GET', '/users/9');

      expect(seenParameter).toBe('9');
      expect(seenName).toBe('users.show');
      expect(router.current()).toBeNull();
      expect(router.currentRouteName()).toBeNull();
    });

    it('reports null while nothing is dispatching or matching failed', async () => {
      await dispatch('GET', '/nowhere');
      expect(router.current()).toBeNull();
    });
  });

  describe('view() and redirect()', () => {
    it('renders through the registered view factory', async () => {
      app.instance('view', {
        make: (name: string, data: Record<string, any>) =>
          new View({ get: async () => `<h1>${data.name}</h1>` } as any, name, '/views', data),
      } as any);

      router.view('/welcome', 'welcome', { name: 'Ada' });

      const res = await dispatch('GET', '/welcome');

      expect(res.status).toBe(200);
      expect(res.body).toBe('<h1>Ada</h1>');
      expect(res.headers['Content-Type']).toBe('text/html');
    });

    it('falls back to the built-in renderer when the view system is missing', async () => {
      router.view('/bye', 'bye', { x: 1 });

      const res = await dispatch('GET', '/bye');

      expect(res.status).toBe(200);
      expect(res.body).toContain('View: bye');
    });

    it('redirects with 302 by default', async () => {
      router.redirect('/here', '/there');

      const res = await dispatch('GET', '/here');

      expect(res.status).toBe(302);
      expect(res.headers['Location']).toBe('/there');
    });

    it('redirects with a custom status', async () => {
      router.redirect('/old', '/new', 301);

      const res = await dispatch('GET', '/old');

      expect(res.status).toBe(301);
      expect(res.headers['Location']).toBe('/new');
    });
  });

  describe('named route URLs', () => {
    it('generates URLs and pushes unused parameters into the query string', () => {
      const showRoute = router.get('/users/:id', () => {});
      router.name('users.show', showRoute);

      expect(router.url('users.show', { id: 1 })).toBe('/users/1');
      expect(router.url('users.show', { id: 1, page: 2 })).toBe('/users/1?page=2');
      expect(router.url('users.show', 7)).toBe('/users/7');
    });

    it('throws for undefined route names', () => {
      expect(() => router.url('ghost')).toThrow(/Route \[ghost\] not defined/);
    });

    it('the route() helper resolves the router from the container', () => {
      app.singleton('router', () => router);
      const showRoute = router.get('/users/:id', () => {});
      router.name('users.show', showRoute);

      expect(route('users.show', { id: 3 })).toBe('/users/3');
    });
  });

  describe('group attribute composition', () => {
    it('composes prefix, name, domain and middleware across nested groups', async () => {
      const mw = vi.fn((_req: any, _res: any, next: () => void) => next());
      let users: Route | undefined;

      router.group({ prefix: 'api', name: 'v1' }, () => {
        router.group({ domain: 'example.com', middleware: mw }, () => {
          users = router.get('/users/:id', () => ({ handled: true }));
          router.name('users.show', users);
        });
      });

      expect(users!.uri).toBe('/api/users/:id');
      expect(users!.name).toBe('v1.users.show');
      expect(users!.domain).toBe('example.com');
      expect(users!.middlewareList).toContain(mw);

      expect(router.findRoute('GET', '/api/users/1', 'example.com')).not.toBeNull();
      expect(router.findRoute('GET', '/api/users/1', 'other.com')).toBeNull();
      expect(router.url('v1.users.show', { id: 1, ref: 'nav' })).toBe('http://example.com/api/users/1?ref=nav');

      const ok = await dispatch('GET', '/api/users/1', { host: 'example.com' });
      expect(ok.status).toBe(200);
      expect(ok.json()).toEqual({ handled: true });
      expect(mw).toHaveBeenCalledTimes(1);

      const wrongHost = await dispatch('GET', '/api/users/1', { host: 'other.com' });
      expect(wrongHost.status).toBe(404);
    });

    it('binds domain :params into the request parameter bag', async () => {
      router.group({ domain: ':account.test' }, () => {
        router.get('/dashboard', (req: Request) => ({ account: req.route('account') }));
      });

      const res = await dispatch('GET', '/dashboard', { host: 'acme.test' });

      expect(res.json()).toEqual({ account: 'acme' });
    });

    it('name prefixes join across several groups and tolerate trailing dots', () => {
      let named: Route | undefined;

      router.group({ name: 'admin.' }, () => {
        router.group({ name: 'v2' }, () => {
          named = router.get('/stats', () => {});
          router.name('stats', named);
        });
      });

      expect(named!.name).toBe('admin.v2.stats');
      expect(router.getByName('admin.v2.stats')).toBe(named);
    });
  });

  describe('request-scoped parameter binding', () => {
    it('two concurrent requests to /users/:id receive their own parameter values', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      router.get('/users/:id', async (req: Request) => {
        const before = req.route('id');
        await gate;
        return { before, after: req.route('id'), current: router.current()?.parameter('id') };
      });

      const pendingA = dispatch('GET', '/users/1');
      const pendingB = dispatch('GET', '/users/2');
      release();

      const [a, b] = await Promise.all([pendingA, pendingB]);

      expect(a.json()).toEqual({ before: '1', after: '1', current: '1' });
      expect(b.json()).toEqual({ before: '2', after: '2', current: '2' });
    });

    it('never mutates the shared route registration', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const registered = router.get('/users/:id', async (req: Request) => {
        await gate;
        return { id: req.route('id') };
      });

      const pendingA = dispatch('GET', '/users/1');
      const pendingB = dispatch('GET', '/users/2');
      release();

      const [a, b] = await Promise.all([pendingA, pendingB]);

      expect(a.json()).toEqual({ id: '1' });
      expect(b.json()).toEqual({ id: '2' });
      expect(registered.parameters).toEqual({});
    });

    it('binders substitute into the per-request copy only', async () => {
      router.bind('token', (value) => `bound:${value}`);
      const registered = router.get('/tokens/:token', (req: Request) => ({ token: req.route('token') }));

      const res = await dispatch('GET', '/tokens/xyz');

      expect(res.json()).toEqual({ token: 'bound:xyz' });
      expect(registered.parameters).toEqual({});
    });
  });
});
