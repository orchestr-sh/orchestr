import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Middleware, NextFunction, TerminableMiddleware } from '@/Routing/Pipeline';
import { Application } from '@/Foundation/Application';
import { Kernel } from '@/Foundation/Http/Kernel';
import { Request } from '@/Routing/Request';
import { Response } from '@/Routing/Response';
import { Router } from '@/Routing/Router';

describe('Middleware pipeline registration', () => {
  let app: Application;
  let router: Router;
  let kernel: Kernel;

  beforeEach(() => {
    app = new Application('/test');
    router = new Router(app);
    app.singleton('router', () => router);
    kernel = new Kernel(app);
  });

  // -------------------------------------------------------------------------
  // Dispatch harnesses - router.dispatch directly, or the full Kernel stack
  // -------------------------------------------------------------------------

  interface DispatchResult {
    status: number;
    body: string;
    headers: Record<string, string>;
  }

  function createRawRequest(method: string, url: string): IncomingMessage {
    const req = new IncomingMessage(new Socket());
    req.method = method;
    req.url = url;
    req.headers = {};
    return req;
  }

  function captureResponse(): { raw: ServerResponse; chunks: string[]; headers: Record<string, string> } {
    const raw = new ServerResponse(new IncomingMessage(new Socket()));
    const chunks: string[] = [];
    const headers: Record<string, string> = {};

    raw.end = ((data?: any) => {
      if (data !== undefined && data !== null) {
        chunks.push(String(data));
      }
    }) as any;
    raw.setHeader = ((name: string, value: any) => {
      headers[name] = String(value);
    }) as any;

    return { raw, chunks, headers };
  }

  async function dispatch(method: string, url: string): Promise<DispatchResult> {
    const request = new Request(createRawRequest(method, url));
    const { raw, chunks, headers } = captureResponse();

    await router.dispatch(request, new Response(raw));

    return { status: raw.statusCode, body: chunks.join(''), headers };
  }

  async function handle(method: string, url: string): Promise<DispatchResult> {
    const { raw, chunks, headers } = captureResponse();

    await kernel.handle(createRawRequest(method, url), raw);

    return { status: raw.statusCode, body: chunks.join(''), headers };
  }

  /** Middleware that appends a label to the shared execution log */
  function recorded(log: string[], label: string): Middleware {
    return async (_req: Request, _res: Response, next: NextFunction) => {
      log.push(label);
      await next();
    };
  }

  describe('aliases', () => {
    it("->middleware('auth') resolves the auth alias", async () => {
      const log: string[] = [];
      kernel.middlewareAlias('auth', recorded(log, 'auth'));

      router.get('/x', () => void log.push('action')).middleware('auth');

      await dispatch('GET', '/x');

      expect(log).toEqual(['auth', 'action']);
      expect(router.getMiddleware()['auth']).toBeTypeOf('function');
    });

    it('throws for a name registered neither as alias nor group', async () => {
      router.get('/x', () => ({})).middleware('ghost');

      const res = await dispatch('GET', '/x');

      expect(res.status).toBe(500);
      expect(res.body).toContain('Middleware [ghost] is not registered');
    });
  });

  describe('groups', () => {
    it("->middleware('web') expands the web group in the declared order", async () => {
      const log: string[] = [];
      kernel.middlewareAlias('auth', recorded(log, 'auth'));
      kernel.middlewareGroup('web', [recorded(log, 'trim'), 'auth', recorded(log, 'hydrate')]);

      router.get('/x', () => void log.push('action')).middleware('web');

      await dispatch('GET', '/x');

      expect(log).toEqual(['trim', 'auth', 'hydrate', 'action']);
      expect(router.getMiddlewareGroups()['web']).toHaveLength(3);
    });

    it('expands nested groups', async () => {
      const log: string[] = [];
      kernel.middlewareGroup('web', [recorded(log, 'a')]);
      kernel.middlewareGroup('admin', ['web', recorded(log, 'b')]);

      router.get('/x', () => void log.push('action')).middleware('admin');

      await dispatch('GET', '/x');

      expect(log).toEqual(['a', 'b', 'action']);
    });

    it('rejects cyclic group references', () => {
      kernel.middlewareGroup('a', ['b']);
      kernel.middlewareGroup('b', ['a']);

      expect(() => router.resolveMiddleware(['a'])).toThrow(/references itself/);
    });

    it('prependMiddlewareToGroup and appendMiddlewareToGroup edit a group', async () => {
      const log: string[] = [];
      kernel.middlewareGroup('web', [recorded(log, 'middle')]);
      kernel.prependMiddlewareToGroup('web', recorded(log, 'first'));
      kernel.appendMiddlewareToGroup('web', recorded(log, 'last'));
      kernel.appendMiddlewareToGroup('api', recorded(log, 'created'));

      router
        .get('/x', () => void log.push('action'))
        .middleware('web')
        .middleware('api');

      await dispatch('GET', '/x');

      expect(log).toEqual(['first', 'middle', 'last', 'created', 'action']);
    });

    it('composes group attributes and route middleware in registration order', async () => {
      const log: string[] = [];

      router.group({ middleware: 'web' }, () => {
        kernel.middlewareGroup('web', [recorded(log, 'web-member')]);
        router.get('/x', () => void log.push('action')).middleware(recorded(log, 'route-mw'));
      });

      await dispatch('GET', '/x');

      expect(log).toEqual(['web-member', 'route-mw', 'action']);
    });
  });

  describe('priority', () => {
    it('reorders middleware to the registered priority', async () => {
      const log: string[] = [];
      kernel.middlewareAlias('auth', recorded(log, 'auth'));
      kernel.middlewareAlias('throttle', recorded(log, 'throttle'));
      kernel.middlewareAlias('log', recorded(log, 'log'));
      kernel.middlewarePriority(['auth', 'throttle', 'log']);

      router.get('/x', () => void log.push('action')).middleware(['throttle', 'log', 'auth']);

      await dispatch('GET', '/x');

      expect(log).toEqual(['auth', 'throttle', 'log', 'action']);
    });

    it('keeps middleware outside the priority list in their relative positions', async () => {
      const log: string[] = [];
      kernel.middlewareAlias('b', recorded(log, 'b'));
      kernel.middlewareAlias('a', recorded(log, 'a'));
      kernel.middlewarePriority(['a', 'b']);

      const anonymous = recorded(log, 'anon');
      router.get('/x', () => void log.push('action')).middleware([anonymous, 'b', 'a']);

      await dispatch('GET', '/x');

      // The port of Laravel's SortedMiddleware moves `a` above `b` but `a`
      // stops at the position the first prioritized middleware occupied
      expect(log).toEqual(['anon', 'a', 'b', 'action']);
    });

    it('runs middleware gathered twice only once', async () => {
      const log: string[] = [];
      kernel.middlewareAlias('auth', recorded(log, 'auth'));
      kernel.middlewareGroup('web', ['auth', recorded(log, 'csrf')]);

      router.get('/x', () => void log.push('action')).middleware(['web', 'auth']);

      await dispatch('GET', '/x');

      expect(log).toEqual(['auth', 'csrf', 'action']);
    });
  });

  describe('withoutMiddleware()', () => {
    it('removes only the named alias, including from inside a group', async () => {
      const log: string[] = [];
      kernel.middlewareAlias('auth', recorded(log, 'auth'));
      kernel.middlewareAlias('signed', recorded(log, 'signed'));
      kernel.middlewareGroup('web', ['auth', 'signed', recorded(log, 'csrf')]);

      router
        .get('/x', () => void log.push('action'))
        .middleware('web')
        .withoutMiddleware('auth');

      await dispatch('GET', '/x');

      expect(log).toEqual(['signed', 'csrf', 'action']);
    });

    it('removes an entire group by name', async () => {
      const log: string[] = [];
      kernel.middlewareGroup('web', [recorded(log, 'a'), recorded(log, 'b')]);

      router
        .get('/x', () => void log.push('action'))
        .middleware(['web', recorded(log, 'kept')])
        .withoutMiddleware('web');

      await dispatch('GET', '/x');

      expect(log).toEqual(['kept', 'action']);
    });

    it('removes an anonymous middleware by reference', async () => {
      const log: string[] = [];
      const drop = recorded(log, 'drop');

      router
        .get('/x', () => void log.push('action'))
        .middleware([drop, recorded(log, 'keep')])
        .withoutMiddleware(drop);

      await dispatch('GET', '/x');

      expect(log).toEqual(['keep', 'action']);
    });

    it('does not affect other routes', async () => {
      const log: string[] = [];
      kernel.middlewareAlias('auth', recorded(log, 'auth'));

      router.get('/open', () => void log.push('open-action')).middleware('auth');
      router
        .get('/skip', () => void log.push('skip-action'))
        .middleware('auth')
        .withoutMiddleware('auth');

      await dispatch('GET', '/open');
      await dispatch('GET', '/skip');

      expect(log).toEqual(['auth', 'open-action', 'skip-action']);
    });
  });

  describe('short-circuiting and termination through the router', () => {
    it('route middleware can answer before the action runs', async () => {
      kernel.middlewareAlias('auth', (_req: Request, res: Response) => res.status(401).send('Unauthorized'));

      const action = vi.fn();
      router.get('/x', action).middleware('auth');

      const res = await dispatch('GET', '/x');

      expect(res.status).toBe(401);
      expect(action).not.toHaveBeenCalled();
    });

    it('terminates route middleware after the response is sent', async () => {
      const events: string[] = [];
      const session: TerminableMiddleware = Object.assign(
        async (_req: Request, _res: Response, next: NextFunction) => {
          events.push('start');
          await next();
        },
        {
          terminate: (_req: Request, res: Response) => {
            events.push('terminate');
            expect(res.finished).toBe(true);
          },
        }
      );

      router.get('/x', (_req: Request, res: Response) => res.send('page')).middleware(session);

      await dispatch('GET', '/x');

      expect(events).toEqual(['start', 'terminate']);
    });

    it('terminates even when the action throws', async () => {
      let terminated = false;
      const watcher: TerminableMiddleware = Object.assign(
        (_req: Request, _res: Response, next: NextFunction) => next(),
        { terminate: () => void (terminated = true) }
      );

      router
        .get('/x', () => {
          throw new Error('boom');
        })
        .middleware(watcher);

      const res = await dispatch('GET', '/x');

      expect(res.status).toBe(500);
      expect(terminated).toBe(true);
    });
  });

  describe('kernel global stack', () => {
    it('declares global middleware once for every route', async () => {
      const log: string[] = [];
      kernel.middlewareAlias('cors', recorded(log, 'cors'));
      kernel.use('cors');
      kernel.use(recorded(log, 'global'));

      router.get('/a', () => void log.push('a'));
      router.get('/b', (_req: Request, _res: Response) => void log.push('b')).middleware(recorded(log, 'route-mw'));

      await handle('GET', '/a');
      await handle('GET', '/b');

      expect(log).toEqual(['cors', 'global', 'a', 'cors', 'global', 'route-mw', 'b']);
    });

    it('global middleware short-circuits before the router is reached', async () => {
      kernel.use((_req: Request, res: Response) => res.status(503).send('Down'));

      const action = vi.fn();
      router.get('/x', action);

      const res = await handle('GET', '/x');

      expect(res.status).toBe(503);
      expect(res.body).toBe('Down');
      expect(action).not.toHaveBeenCalled();
    });

    it('global middleware wraps route middleware on the way back out', async () => {
      const log: string[] = [];

      kernel.use(async (_req: Request, _res: Response, next: NextFunction) => {
        log.push('global-in');
        await next();
        log.push('global-out');
      });

      const routeMw: Middleware = async (_req: Request, _res: Response, next: NextFunction) => {
        log.push('route-in');
        await next();
        log.push('route-out');
      };

      router.get('/x', (_req: Request, res: Response) => res.send('ok')).middleware(routeMw);

      await handle('GET', '/x');

      expect(log).toEqual(['global-in', 'route-in', 'route-out', 'global-out']);
    });

    it('terminates global middleware after the response', async () => {
      const events: string[] = [];
      const globalTerminable: TerminableMiddleware = Object.assign(
        async (_req: Request, _res: Response, next: NextFunction) => {
          await next();
        },
        { terminate: () => void events.push('global-terminate') }
      );
      const routeTerminable: TerminableMiddleware = Object.assign(
        async (_req: Request, _res: Response, next: NextFunction) => {
          await next();
        },
        { terminate: () => void events.push('route-terminate') }
      );

      kernel.use(globalTerminable);
      router.get('/x', (_req: Request, res: Response) => res.send('ok')).middleware(routeTerminable);

      await handle('GET', '/x');

      expect(events).toEqual(['route-terminate', 'global-terminate']);
    });
  });
});
