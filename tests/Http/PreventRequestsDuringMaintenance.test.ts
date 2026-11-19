/**
 * PreventRequestsDuringMaintenance - the 503 wall and its bypasses
 *
 * Drives full Kernel round trips with the middleware registered and the
 * maintenance state driven through Application.maintenanceMode(): blocked
 * requests answer 503 with Retry-After (JSON for API clients, the recorded
 * message or `--render` view for HTML), allow-listed paths and requests
 * carrying the secret (query first, then cookie) keep flowing through.
 */

import { captureResponse, createRawRequest } from '@tests/Session/support';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MaintenanceModeData } from '@/Foundation/MaintenanceMode';
import type { ViewFactory } from '@/View/ViewFactory';
import { DownCommand } from '@/Console/Commands/DownCommand';
import { UpCommand } from '@/Console/Commands/UpCommand';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { Kernel } from '@/Foundation/Http/Kernel';
import {
  MAINTENANCE_COOKIE,
  makePreventRequestsDuringMaintenance,
  PreventRequestsDuringMaintenance,
  resolveMaintenanceConfig,
} from '@/Foundation/Http/Middleware/PreventRequestsDuringMaintenance';
import { Request } from '@/Routing/Request';
import { Response } from '@/Routing/Response';
import { Router } from '@/Routing/Router';

interface Captured {
  status: number;
  body: string;
  headers: Record<string, string>;
  cookies: string[];
}

interface Harness {
  app: Application;
  request(method: string, url: string, headers?: Record<string, string>): Promise<Captured>;
}

let base: string;

async function maintenanceApp(
  maintenance: Record<string, unknown> = {},
  register: 'default' | ((app: Application) => void) = 'default'
): Promise<Harness> {
  base = mkdtempSync(join(tmpdir(), 'orchestr-maintenance-'));

  const app = new Application(base);

  app.instance('config', new Config({ maintenance }));

  const router = new Router(app);
  app.singleton('router', () => router);

  const kernel = new Kernel(app);
  app.instance('kernel', kernel);

  if (register === 'default') {
    kernel.prepend(PreventRequestsDuringMaintenance);
  } else {
    register(app);
  }

  router.get('/test', (_req: Request, res: Response) => res.send('online'));
  router.get('/up', (_req: Request, res: Response) => res.send('healthy'));
  router.get('/health/deep', (_req: Request, res: Response) => res.send('deep-ok'));

  async function request(method: string, url: string, headers: Record<string, string> = {}): Promise<Captured> {
    const { raw, chunks, headers: sent, cookies } = captureResponse();

    await kernel.handle(createRawRequest(method, url, { headers }), raw);

    return { status: raw.statusCode, body: chunks.join(''), headers: sent, cookies };
  }

  return { app, request };
}

function down(app: Application, data: MaintenanceModeData = {}): void {
  app.maintenanceMode().activate(data);
}

beforeEach(() => {
  base = '';
});

afterEach(() => {
  if (base !== '') {
    rmSync(base, { recursive: true, force: true });
  }
});

describe('PreventRequestsDuringMaintenance middleware', () => {
  it('lets every request flow through while the application is up', async () => {
    const { request } = await maintenanceApp();

    const response = await request('GET', '/test');

    expect(response.status).toBe(200);
    expect(response.body).toBe('online');
  });

  it('answers blocked requests with 503, Retry-After and the default message', async () => {
    const { app, request } = await maintenanceApp();

    down(app);

    const response = await request('GET', '/test');

    expect(response.status).toBe(503);
    expect(response.headers['Retry-After']).toBe('60');
    expect(response.body).toContain('Service Unavailable');
  });

  it('carries the recorded message and retry lifetime', async () => {
    const { app, request } = await maintenanceApp();

    down(app, { message: 'Back at five', retry: 120 });

    const response = await request('GET', '/test');

    expect(response.status).toBe(503);
    expect(response.headers['Retry-After']).toBe('120');
    expect(response.body).toBe('Back at five');
  });

  it('answers API clients with a 503 JSON message', async () => {
    const { app, request } = await maintenanceApp();

    down(app, { message: 'Back at five' });

    const response = await request('GET', '/test', { accept: 'application/json' });

    expect(response.status).toBe(503);
    expect(response.headers['Retry-After']).toBe('60');
    expect(JSON.parse(response.body)).toEqual({ message: 'Back at five' });
  });

  it('renders the recorded view for HTML requests', async () => {
    const { app, request } = await maintenanceApp();

    app.instance('view', {
      exists: (view: string) => view === 'pages.down',
      make: (view: string, data: Record<string, any>) => ({
        render: async () => `<h1>${view}:${String(data.message)}</h1>`,
      }),
    } as unknown as ViewFactory);

    down(app, { message: 'Down down', render: 'pages.down' });

    const rendered = await request('GET', '/test', { accept: 'text/html' });

    expect(rendered.status).toBe(503);
    expect(rendered.body).toBe('<h1>pages.down:Down down</h1>');

    // A view that cannot be rendered falls back to the plain message
    app.instance('view', {
      exists: () => false,
      make: () => ({ render: async () => '' }),
    } as unknown as ViewFactory);

    down(app, { message: 'No view here', render: 'pages.gone' });

    const fallback = await request('GET', '/test');

    expect(fallback.status).toBe(503);
    expect(fallback.body).toBe('No view here');
  });

  it('bypasses the wall for requests carrying the secret, handing out the cookie', async () => {
    const { app, request } = await maintenanceApp();

    down(app, { secret: 'open-sesame' });

    expect((await request('GET', '/test')).status).toBe(503);

    const visitor = await request('GET', '/test?secret=open-sesame');

    expect(visitor.status).toBe(200);
    expect(visitor.body).toBe('online');
    expect(visitor.cookies.join('\n')).toContain(`${MAINTENANCE_COOKIE}=open-sesame`);

    // Subsequent requests ride the cookie instead of the query string
    const returning = await request('GET', '/test', { cookie: `${MAINTENANCE_COOKIE}=open-sesame` });

    expect(returning.status).toBe(200);
  });

  it('still blocks the wrong secret', async () => {
    const { app, request } = await maintenanceApp();

    down(app, { secret: 'open-sesame' });

    expect((await request('GET', '/test?secret=wrong')).status).toBe(503);
    expect((await request('GET', '/test', { cookie: `${MAINTENANCE_COOKIE}=nope` })).status).toBe(503);
  });

  it('bypasses maintenance for allow-listed paths', async () => {
    const { app, request } = await maintenanceApp({ except: ['up', '/health/*'] });

    down(app, { secret: 'open-sesame' });

    expect((await request('GET', '/up')).status).toBe(200);
    expect((await request('GET', '/health/deep')).status).toBe(200);
    expect((await request('GET', '/test')).status).toBe(503);
  });

  it('honours the factory seams for app and configuration', async () => {
    const harness = await maintenanceApp({}, (app) => {
      const kernel = app.make<Kernel>('kernel');

      kernel.prepend(
        makePreventRequestsDuringMaintenance({
          app: () => app,
          options: () => ({ except: ['up'] }),
        })
      );
    });

    down(harness.app);

    expect((await harness.request('GET', '/up')).status).toBe(200);
    expect((await harness.request('GET', '/test')).status).toBe(503);
  });

  it('treats an untrusted state (empty down file) as blocked with no secret', async () => {
    const { app, request } = await maintenanceApp();

    // decommissioned storage: down, but without data to bypass or display
    app.maintenanceMode().activate();
    expect(app.maintenanceMode().active()).toBe(true);

    const response = await request('GET', '/test', { accept: 'application/json' });

    expect(response.status).toBe(503);
    expect(JSON.parse(response.body)).toEqual({ message: 'Service Unavailable' });
  });
});

describe('resolveMaintenanceConfig', () => {
  it('normalises the except list onto the defaults', () => {
    expect(resolveMaintenanceConfig(undefined)).toEqual({ except: [] });
    expect(resolveMaintenanceConfig({ except: 'up' })).toEqual({ except: ['up'] });
    expect(resolveMaintenanceConfig({ except: ['up', '/webhooks/*'] })).toEqual({ except: ['up', '/webhooks/*'] });
  });
});

describe('down/up with the middleware', () => {
  it('the commands raise and lower the 503 wall end to end', async () => {
    const { app, request } = await maintenanceApp();

    await new DownCommand(app).handle([], { message: 'Down by command', retry: '30', secret: 's3cr3t' });

    const blocked = await request('GET', '/test');

    expect(blocked.status).toBe(503);
    expect(blocked.headers['Retry-After']).toBe('30');
    expect(blocked.body).toBe('Down by command');

    expect((await request('GET', '/test?secret=s3cr3t')).status).toBe(200);

    await new UpCommand(app).handle();

    const live = await request('GET', '/test');

    expect(live.status).toBe(200);
    expect(live.body).toBe('online');
  });
});
