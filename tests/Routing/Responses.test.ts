import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Middleware } from '@/Routing/Pipeline';
import { Application } from '@/Foundation/Application';
import { Request } from '@/Routing/Request';
import { Response } from '@/Routing/Response';
import { JsonResponse } from '@/Routing/Responses/JsonResponse';
import { RedirectResponse } from '@/Routing/Responses/RedirectResponse';
import { ResponseObject } from '@/Routing/Responses/ResponseObject';
import { StreamedResponse } from '@/Routing/Responses/StreamedResponse';
import { Router } from '@/Routing/Router';

describe('Response objects', () => {
  let app: Application;
  let router: Router;

  beforeEach(() => {
    app = new Application('/test');
    router = new Router(app);
  });

  // -------------------------------------------------------------------------
  // Dispatch harness
  // -------------------------------------------------------------------------

  interface DispatchResult {
    status: number;
    body: string;
    json: () => any;
    headers: Record<string, string>;
  }

  async function dispatch(method: string, url: string, headers: Record<string, string> = {}): Promise<DispatchResult> {
    const rawRequest = new IncomingMessage(new Socket());
    rawRequest.method = method;
    rawRequest.url = url;
    rawRequest.headers = headers;

    const request = new Request(rawRequest);
    const raw = new ServerResponse(rawRequest);
    const chunks: string[] = [];
    const sentHeaders: Record<string, string> = {};

    raw.setHeader = ((name: string, value: any) => {
      sentHeaders[name] = String(value);
    }) as any;
    raw.end = ((data?: any) => {
      if (data !== undefined && data !== null) {
        chunks.push(String(data));
      }
    }) as any;
    raw.write = ((chunk?: any) => {
      if (chunk !== undefined && chunk !== null) {
        chunks.push(String(chunk));
      }

      return true;
    }) as any;

    await router.dispatch(request, new Response(raw));

    return {
      status: raw.statusCode,
      body: chunks.join(''),
      json: () => JSON.parse(chunks.join('')),
      headers: sentHeaders,
    };
  }

  describe('JsonResponse', () => {
    it('is delivered with its status, payload and custom headers', async () => {
      router.get('/json', () => new JsonResponse({ ok: true }, 201, { 'X-Flag': 'yes' }));

      const res = await dispatch('GET', '/json');

      expect(res.status).toBe(201);
      expect(res.json()).toEqual({ ok: true });
      expect(res.headers['Content-Type']).toBe('application/json');
      expect(res.headers['X-Flag']).toBe('yes');
    });

    it('supports fluent mutation before delivery', async () => {
      router.get('/json', () => new JsonResponse({ a: 1 }).withStatus(409).withHeader('X-Kind', 'conflict'));

      const res = await dispatch('GET', '/json');

      expect(res.status).toBe(409);
      expect(res.headers['X-Kind']).toBe('conflict');
    });
  });

  describe('RedirectResponse', () => {
    it('answers 302 with a Location header by default', async () => {
      router.get('/here', () => new RedirectResponse('/there'));

      const res = await dispatch('GET', '/here');

      expect(res.status).toBe(302);
      expect(res.headers['Location']).toBe('/there');
      expect(res.body).toBe('');
    });

    it('honours a custom status and extra headers', async () => {
      router.get('/old', () => new RedirectResponse('/new', 301, { 'X-Moved-By': 'router' }));

      const res = await dispatch('GET', '/old');

      expect(res.status).toBe(301);
      expect(res.headers['Location']).toBe('/new');
      expect(res.headers['X-Moved-By']).toBe('router');
    });

    it('the Route::redirect() helper answers with a RedirectResponse', async () => {
      router.redirect('/shortcut', '/destination', 307);

      const res = await dispatch('GET', '/shortcut');

      expect(res.status).toBe(307);
      expect(res.headers['Location']).toBe('/destination');
    });
  });

  describe('StreamedResponse', () => {
    it('streams chunks through its callback and ends the transport', async () => {
      const onSend = vi.fn();

      router.get('/stream', () => {
        onSend();

        return new StreamedResponse((stream) => {
          stream.write('chunk-1');
          stream.write('chunk-2');
        });
      });

      const res = await dispatch('GET', '/stream');

      expect(onSend).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
      expect(res.body).toBe('chunk-1chunk-2');
    });

    it('awaits async callbacks and keeps custom headers', async () => {
      router.get('/slow', () => {
        return new StreamedResponse(
          async (stream) => {
            await Promise.resolve();
            stream.write('late');
          },
          202,
          { 'X-Streamed': 'true' }
        );
      });

      const res = await dispatch('GET', '/slow');

      expect(res.status).toBe(202);
      expect(res.headers['X-Streamed']).toBe('true');
      expect(res.body).toBe('late');
    });
  });

  describe('the base ResponseObject', () => {
    it('carries a literal body with headers', async () => {
      router.get('/text', () => new ResponseObject('plain words', 200, { 'Content-Type': 'text/plain' }));

      const res = await dispatch('GET', '/text');

      expect(res.status).toBe(200);
      expect(res.headers['Content-Type']).toBe('text/plain');
      expect(res.body).toBe('plain words');
    });

    it('sends no body when content is null', async () => {
      router.get('/empty', () => new ResponseObject(null, 204));

      const res = await dispatch('GET', '/empty');

      expect(res.status).toBe(204);
      expect(res.body).toBe('');
    });
  });

  describe('short-circuiting', () => {
    it('middleware returning a response object stops the pipeline', async () => {
      const action = vi.fn();

      const gate: Middleware = () => new JsonResponse({ blocked: true }, 423);

      router.get('/x', action).middleware(gate);

      const res = await dispatch('GET', '/x');

      expect(res.status).toBe(423);
      expect(res.json()).toEqual({ blocked: true });
      expect(action).not.toHaveBeenCalled();
    });

    it('middleware returning a RedirectResponse keeps the destination unseen', async () => {
      const action = vi.fn();

      const gate: Middleware = () => new RedirectResponse('/somewhere-else', 303);

      router.get('/y', action).middleware(gate);

      const res = await dispatch('GET', '/y');

      expect(res.status).toBe(303);
      expect(res.headers['Location']).toBe('/somewhere-else');
      expect(action).not.toHaveBeenCalled();
    });

    it('a returned object never re-writes a transport that already answered', async () => {
      router.get('/written', (req: Request, res: Response) => {
        res.send('written once');

        return new JsonResponse({ ignored: true });
      });

      const res = await dispatch('GET', '/written');

      expect(res.body).toBe('written once');
      expect(res.status).toBe(200);
      expect(res.headers['Content-Type']).toBeUndefined();
    });
  });
});
