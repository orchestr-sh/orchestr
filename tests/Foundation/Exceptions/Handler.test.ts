import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ValidationRules } from '@/Foundation/Http/Validator';
import { Application } from '@/Foundation/Application';
import {
  abort,
  abort_if,
  abort_unless,
  AccessDeniedHttpException,
  AuthenticationException,
  Handler,
  HttpException,
  ModelNotFoundException,
  NotFoundHttpException,
  resolveExceptionHandler,
} from '@/Foundation/Exceptions';
import { FormRequest } from '@/Foundation/Http/FormRequest';
import { Kernel } from '@/Foundation/Http/Kernel';
import { ValidationException } from '@/Foundation/Http/ValidationException';
import { Validator } from '@/Foundation/Http/Validator';
import { Controller } from '@/Routing/Controller';
import { Request } from '@/Routing/Request';
import { Response } from '@/Routing/Response';
import { JsonResponse } from '@/Routing/Responses/JsonResponse';
import { ResponseObject } from '@/Routing/Responses/ResponseObject';
import { Router } from '@/Routing/Router';
import { Injectable } from '@/Support/Injectable';
import { ValidateRequest } from '@/Support/ValidateRequest';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

class LockedThing {
  getTable(): string {
    return 'locked_things';
  }
}

class StoreThingRequest extends FormRequest {
  protected rules(): ValidationRules {
    return { name: 'required|string' };
  }
}

class DeniedThingRequest extends FormRequest {
  protected authorize(): boolean {
    return false;
  }

  protected rules(): ValidationRules {
    return {};
  }
}

@Injectable()
class ExceptionTestController extends Controller {
  @ValidateRequest()
  async store(request: StoreThingRequest) {
    return { created: request.validated() };
  }

  @ValidateRequest()
  async deny(request: DeniedThingRequest) {
    return { unreachable: true };
  }
}

async function failedValidation(): Promise<ValidationException> {
  const validator = new Validator({}, { name: 'required' });
  await validator.validate();

  return new ValidationException(validator);
}

// ---------------------------------------------------------------------------
// Transport harness (same shape as the middleware pipeline suite)
// ---------------------------------------------------------------------------

interface DispatchResult {
  status: number;
  body: string;
  json: () => any;
  headers: Record<string, string>;
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

function createRawRequest(method: string, url: string, headers: Record<string, string> = {}): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.method = method;
  req.url = url;
  req.headers = headers;

  return req;
}

function createRequest(headers: Record<string, string> = {}, method = 'GET', url = '/'): Request {
  return new Request(createRawRequest(method, url, headers));
}

describe('Exception handler', () => {
  let app: Application;
  let router: Router;
  let kernel: Kernel;
  let handler: Handler;

  beforeEach(() => {
    app = new Application('/test');
    router = new Router(app);
    app.singleton('router', () => router);
    kernel = new Kernel(app);
    handler = kernel.getExceptionHandler();
  });

  afterEach(() => {
    delete process.env.DEBUG;
    vi.restoreAllMocks();
  });

  /** Full Kernel stack: global middleware, body parsing, router dispatch */
  async function handle(method: string, url: string, headers: Record<string, string> = {}): Promise<DispatchResult> {
    const incoming = createRawRequest(method, url, headers);

    // Feed an empty body so parseBody() resolves for POST/PUT/PATCH
    process.nextTick(() => incoming.emit('end'));

    const { raw, chunks, headers: sentHeaders } = captureResponse();

    await kernel.handle(incoming, raw);

    return {
      status: raw.statusCode,
      body: chunks.join(''),
      json: () => JSON.parse(chunks.join('')),
      headers: sentHeaders,
    };
  }

  /** Router.dispatch directly, without the Kernel's global stack */
  async function dispatch(method: string, url: string, headers: Record<string, string> = {}): Promise<DispatchResult> {
    const request = createRequest(headers, method, url);
    const { raw, chunks, headers: sentHeaders } = captureResponse();

    await router.dispatch(request, new Response(raw));

    return {
      status: raw.statusCode,
      body: chunks.join(''),
      json: () => JSON.parse(chunks.join('')),
      headers: sentHeaders,
    };
  }

  describe('status mapping', () => {
    it('renders validation failures as 422 JSON with an errors object', async () => {
      const exception = await failedValidation();

      const response = handler.render(createRequest({ accept: 'application/json' }), exception);

      expect(response).toBeInstanceOf(JsonResponse);
      expect(response.status).toBe(422);

      const payload = (response as JsonResponse).data;
      expect(payload.message).toBe('The given data was invalid.');
      expect(payload.errors.name).toBeDefined();
    });

    it('renders authentication failures as 401', () => {
      const response = handler.render(createRequest({ accept: 'application/json' }), new AuthenticationException());

      expect(response.status).toBe(401);
      expect((response as JsonResponse).data).toEqual({ message: 'Unauthenticated.' });
    });

    it('renders authorization failures as 403', () => {
      const response = handler.render(createRequest({ accept: 'application/json' }), new AccessDeniedHttpException());

      expect(response.status).toBe(403);
      expect((response as JsonResponse).data).toEqual({ message: 'This action is unauthorized.' });
    });

    it('renders missing models as 404', () => {
      const response = handler.render(
        createRequest({ accept: 'application/json' }),
        ModelNotFoundException.forModel(LockedThing, [7])
      );

      expect(response.status).toBe(404);
      expect((response as JsonResponse).data.message).toContain('No query results for model [LockedThing] 7');
    });

    it('maps unknown throwables onto 500', () => {
      const response = handler.render(createRequest(), 'just a string');

      expect(response.status).toBe(500);
      expect((response as JsonResponse).data).toEqual({ message: 'just a string' });
    });
  });

  describe('negotiation', () => {
    it('answers JSON when the request expects JSON', () => {
      const response = handler.render(createRequest({ accept: 'application/json' }), new NotFoundHttpException());

      expect(response).toBeInstanceOf(JsonResponse);
    });

    it('answers JSON for AJAX requests', () => {
      const response = handler.render(
        createRequest({ 'x-requested-with': 'XMLHttpRequest' }),
        new NotFoundHttpException()
      );

      expect(response.status).toBe(404);
      expect((response as JsonResponse).data).toEqual({ message: 'Not Found' });
    });

    it('answers HTML when the client accepts HTML', () => {
      const response = handler.render(
        createRequest({ accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }),
        new NotFoundHttpException('Post not found')
      );

      expect(response).toBeInstanceOf(ResponseObject);
      expect(response.status).toBe(404);
      expect(response.headers['Content-Type']).toBe('text/html');
      expect(response.content).toContain('<!DOCTYPE html>');
      expect(response.content).toContain('404 Not Found');
      expect(response.content).toContain('Post not found');
    });

    it('falls back to JSON when no renderer claims the request (no Accept header)', () => {
      const response = handler.render(createRequest(), new NotFoundHttpException());

      expect((response as JsonResponse).data).toEqual({ message: 'Not Found' });
    });

    it('forces JSON for routes under the api prefix, even when HTML is accepted', async () => {
      router.group({ prefix: 'api' }, () => {
        router.get('/users/:id', () => abort(404, 'User missing'));
      });

      const res = await handle('GET', '/api/users/5', { accept: 'text/html' });

      expect(res.status).toBe(404);
      expect(res.headers['Content-Type']).toBe('application/json');
      expect(res.json()).toEqual({ message: 'User missing' });
    });

    it('serves HTML to browsers for non-API routes', async () => {
      router.get('/posts/:id', () => abort(404, 'Post missing'));

      const res = await handle('GET', '/posts/5', { accept: 'text/html' });

      expect(res.status).toBe(404);
      expect(res.headers['Content-Type']).toBe('text/html');
      expect(res.body).toContain('Post missing');
    });
  });

  describe('custom headers', () => {
    it('preserves HttpException headers on the rendered response', async () => {
      router.get('/locked', () => abort(423, 'Still editing', { 'X-Reason': 'lease held' }));

      const res = await handle('GET', '/locked');

      expect(res.status).toBe(423);
      expect(res.headers['X-Reason']).toBe('lease held');
      expect(res.json()).toEqual({ message: 'Still editing' });
    });

    it('preserves headers on HTML rendering too', () => {
      const response = handler.render(
        createRequest({ accept: 'text/html' }),
        new HttpException(429, 'Slow down', { 'Retry-After': '30' })
      );

      expect(response.headers['Retry-After']).toBe('30');
    });
  });

  describe('debug vs production', () => {
    it('includes the stack trace in JSON only when debug is enabled', () => {
      const exception = new Error('kaboom');

      const production = handler.render(createRequest({ accept: 'application/json' }), exception);
      expect((production as JsonResponse).data.stack).toBeUndefined();

      process.env.DEBUG = 'true';

      const debug = handler.render(createRequest({ accept: 'application/json' }), exception);
      expect((debug as JsonResponse).data.stack).toContain('kaboom');
    });

    it('shows the stack in the HTML page only when debug is enabled', () => {
      const exception = new Error('kaboom');

      const production = handler.render(createRequest({ accept: 'text/html' }), exception);
      expect(production.content).not.toContain('<pre class="trace">');

      process.env.DEBUG = 'true';

      const debug = handler.render(createRequest({ accept: 'text/html' }), exception);
      expect(debug.content).toContain('<pre class="trace">');
      expect(debug.content).toContain('Error: kaboom');
      expect(debug.content).toContain('at ');
    });

    it('escapes HTML control characters in the error page', () => {
      const response = handler.render(
        createRequest({ accept: 'text/html' }),
        new NotFoundHttpException('<script>alert("xss")</script>')
      );

      expect(response.content).not.toContain('<script>alert');
      expect(response.content).toContain('&lt;script&gt;');
    });
  });

  describe('reporting', () => {
    it('reports through console.error by default', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('logged');

      handler.report(error);

      expect(spy).toHaveBeenCalledWith('Error handling request:', error);
    });

    it('honours dontReport through shouldReport', () => {
      class IgnoreMe extends Error {}

      expect(handler.shouldReport(new IgnoreMe())).toBe(true);

      handler.dontReport(IgnoreMe);

      expect(handler.shouldReport(new IgnoreMe())).toBe(false);
      expect(handler.shouldReport(new Error('other'))).toBe(true);

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      handler.report(new IgnoreMe());
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('Kernel and Router share one handler', () => {
    it('resolves the same container-bound instance from both entry points', () => {
      expect(kernel.getExceptionHandler()).toBe(router.getExceptionHandler());
      expect(app.make('exceptions')).toBe(kernel.getExceptionHandler());
    });

    it('dontReport applied through the Kernel is observed by the Router', async () => {
      class ExpectedFailure extends Error {}

      kernel.getExceptionHandler().dontReport(ExpectedFailure);

      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      router.get('/boom', () => {
        throw new ExpectedFailure('handled quietly');
      });

      const res = await dispatch('GET', '/boom');

      expect(res.status).toBe(500);
      expect(spy).not.toHaveBeenCalled();
    });

    it('resolveExceptionHandler registers a shared default handler', () => {
      const fresh = new Application('/fresh');

      expect(fresh.bound('exceptions')).toBe(false);

      const first = resolveExceptionHandler(fresh);
      const second = resolveExceptionHandler(fresh);

      expect(first).toBe(second);
      expect(fresh.bound('exceptions')).toBe(true);
    });
  });

  describe('HTTP integration through the Kernel', () => {
    it('abort(404) answers 404 with a useful message', async () => {
      router.get('/ghost', () => abort(404));

      const res = await handle('GET', '/ghost');

      expect(res.status).toBe(404);
      expect(res.json()).toEqual({ message: 'Not Found' });
    });

    it('abort_if and abort_unless answer through the handler', async () => {
      router.get('/gate/:allow', (req: Request) => {
        const allowed = req.route('allow') === 'yes';

        abort_if(!allowed, 403, 'Not allowed');
        abort_unless(allowed, 403, 'unreached when allowed');

        return { passed: true };
      });

      const denied = await handle('GET', '/gate/no', { accept: 'application/json' });
      expect(denied.status).toBe(403);
      expect(denied.json()).toEqual({ message: 'Not allowed' });

      const allowed = await handle('GET', '/gate/yes', { accept: 'application/json' });
      expect(allowed.status).toBe(200);
      expect(allowed.json()).toEqual({ passed: true });
    });

    it('a FormRequest failure answers 422 with the error bag', async () => {
      router.post('/things', [ExceptionTestController, 'store']);

      const res = await handle('POST', '/things');

      expect(res.status).toBe(422);
      expect(res.json().message).toBe('The given data was invalid.');
      expect(res.json().errors.name).toBeDefined();
    });

    it('a FormRequest denial answers 403 without the action running', async () => {
      router.post('/denied', [ExceptionTestController, 'deny']);

      const res = await handle('POST', '/denied');

      expect(res.status).toBe(403);
      expect(res.json()).toEqual({ message: 'This action is unauthorized.' });
    });

    it('a missing model answers 404 through the handler', async () => {
      router.get('/models/:id', () => {
        throw ModelNotFoundException.forModel(LockedThing, [99]);
      });

      const res = await handle('GET', '/models/99');

      expect(res.status).toBe(404);
      expect(res.json().message).toContain('No query results for model [LockedThing] 99');
    });

    it('an unauthenticated request answers 401', async () => {
      router.get('/private', () => {
        throw new AuthenticationException();
      });

      const res = await handle('GET', '/private');

      expect(res.status).toBe(401);
      expect(res.json()).toEqual({ message: 'Unauthenticated.' });
    });

    it('unmatched paths answer 404 through the handler', async () => {
      router.get('/known', () => ({ ok: true }));

      const res = await handle('GET', '/nowhere', { accept: 'application/json' });

      expect(res.status).toBe(404);
      expect(res.json()).toEqual({ message: 'Not Found' });
    });

    it('errors thrown from global middleware are reported and rendered', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      kernel.use(() => {
        throw new HttpException(503, 'Readonly', { 'X-Down': 'yes' });
      });
      router.get('/x', () => ({ never: true }));

      const res = await handle('GET', '/x');

      expect(res.status).toBe(503);
      expect(res.headers['X-Down']).toBe('yes');
      expect(res.json()).toEqual({ message: 'Readonly' });
      expect(spy).toHaveBeenCalled();
    });
  });
});
