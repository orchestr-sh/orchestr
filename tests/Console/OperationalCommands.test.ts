/**
 * Operational command tests
 *
 * Covers the ticket's required behaviours: route:list output (table, JSON,
 * --path filter), the route:cache round-trip including boot-from-cache and
 * route:clear, key:generate writing APP_KEY without clobbering the rest of
 * .env, storage:link idempotency, the about report, and the destructive
 * commands refusing to run without --force when non-interactive.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AboutCommand } from '@/Console/Commands/AboutCommand';
import { DbMonitorCommand } from '@/Console/Commands/DbMonitorCommand';
import { DbWipeCommand } from '@/Console/Commands/DbWipeCommand';
import { KeyGenerateCommand } from '@/Console/Commands/KeyGenerateCommand';
import { ModelShowCommand } from '@/Console/Commands/ModelShowCommand';
import { OptimizeClearCommand } from '@/Console/Commands/OptimizeClearCommand';
import { OptimizeCommand } from '@/Console/Commands/OptimizeCommand';
import { RouteCacheCommand } from '@/Console/Commands/RouteCacheCommand';
import { RouteClearCommand } from '@/Console/Commands/RouteClearCommand';
import { RouteListCommand } from '@/Console/Commands/RouteListCommand';
import { ServeCommand } from '@/Console/Commands/ServeCommand';
import { StorageLinkCommand } from '@/Console/Commands/StorageLinkCommand';
import { Migrator } from '@/Database/Migrations/Migrator';
import { FilesystemManager } from '@/Filesystem/FilesystemManager';
import { Application } from '@/Foundation/Application';
import { ConfigServiceProvider } from '@/Foundation/Config/ConfigServiceProvider';
import { RouteServiceProvider } from '@/Providers/RouteServiceProvider';
import { Router } from '@/Routing/Router';

function captureOutput(): { logs: string[]; errors: string[]; restore: () => void } {
  const logs: string[] = [];
  const errors: string[] = [];

  const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => void logs.push(String(message)));
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((message?: unknown) => void logs.push(String(message)));
  const errorSpy = vi
    .spyOn(console, 'error')
    .mockImplementation((message?: unknown) => void errors.push(String(message)));

  return {
    logs,
    errors,
    restore: () => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}

// The destructive-command gates key off the session's interactivity; pin
// stdin to a non-TTY so the suite behaves identically inside a terminal.
const originalStdinTty = process.stdin.isTTY;

beforeEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
});

afterEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinTty, configurable: true });
});

describe('route:list', () => {
  let base: string;
  let app: Application;
  let router: Router;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'orchestr-routes-'));
    app = new Application(base);
    router = new Router(app);
    app.instance('router', router);

    const index = router.get('/users', 'UserController@index');
    index.middleware('auth');
    router.name('users.index', index);

    router.post('/users', 'UserController@store');

    const show = router.get('/posts/:id', 'PostController@show');
    show.where('id', '[0-9]+');

    router.get('/closure', () => 'hi');
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('prints methods, URIs, names, actions, and middleware for every route', async () => {
    const output = captureOutput();

    try {
      await new RouteListCommand(app).handle([], {});
    } finally {
      output.restore();
    }

    const printed = output.logs.join('\n');

    expect(printed).toContain('Method');
    expect(printed).toContain('URI');
    expect(printed).toContain('Action');
    expect(printed).toContain('Middleware');
    expect(printed).toContain('GET|HEAD');
    expect(printed).toContain('/users');
    expect(printed).toContain('users.index');
    expect(printed).toContain('UserController@index');
    expect(printed).toContain('UserController@store');
    expect(printed).toContain('auth');
    expect(printed).toContain('Showing [4] routes');
  });

  it('filters by --path and renders --json', async () => {
    const filtered = captureOutput();

    try {
      await new RouteListCommand(app).handle([], { path: 'posts' });
    } finally {
      filtered.restore();
    }

    const printed = filtered.logs.join('\n');
    expect(printed).toContain('/posts/:id');
    expect(printed).not.toContain('/users');

    const json = captureOutput();

    try {
      await new RouteListCommand(app).handle([], { json: true });
    } finally {
      json.restore();
    }

    const rows = JSON.parse(json.logs.join(''));

    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      method: 'GET|HEAD',
      uri: '/users',
      name: 'users.index',
      action: 'UserController@index',
    });
    expect(rows[0].middleware).toBe('auth');
    expect(rows[3].action).toBe('Closure');
  });

  it('reports instead of crashing when the router is not registered', async () => {
    const bare = new Application(base);
    const output = captureOutput();

    try {
      await new RouteListCommand(bare).handle([], {});
    } finally {
      output.restore();
    }

    expect(output.errors.join('\n')).toContain('router is not registered');
  });
});

describe('route:cache / route:clear', () => {
  let base: string;
  let app: Application;

  function defineRoutes(router: Router): void {
    const index = router.get('/users', 'UserController@index');
    index.middleware('web');
    router.name('users.index', index);

    const show = router.get('/posts/:id', 'PostController@show');
    show.where('id', '[0-9]+');

    router.fallback('FallbackController@index');
  }

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'orchestr-routecache-'));
    app = new Application(base);
    app.singleton('router', () => new Router(app));
    defineRoutes(app.make<Router>('router'));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
    delete process.env.APP_ROUTES_CACHE;
  });

  it('writes the snapshot, boots a fresh app from it, and clears again', async () => {
    const cacheOutput = captureOutput();

    try {
      await new RouteCacheCommand(app).handle([], {});
    } finally {
      cacheOutput.restore();
    }

    expect(cacheOutput.logs.join('\n')).toContain('Routes cached successfully!');
    expect(existsSync(join(base, 'bootstrap/cache/routes.json'))).toBe(true);

    // A brand-new application over the same base path (no route files at
    // all) boots the collection back out of the cache via the provider.
    const second = new Application(base);
    second.register(RouteServiceProvider);
    await second.boot();

    const restored = second.make<Router>('router').getRoutes();

    expect(restored.map((route) => `${route.methods.join('|')} ${route.uri}`)).toEqual([
      'GET|HEAD /users',
      'GET|HEAD /posts/:id',
      'GET|HEAD /:fallback',
    ]);
    expect(restored[0].middlewareList).toEqual(['web']);
    expect(restored[0].name).toBe('users.index');
    expect(restored[1].wheres).toEqual({ id: '[0-9]+' });
    expect(restored[2].isFallback).toBe(true);
    expect(second.make<Router>('router').getByName('users.index')?.uri).toBe('/users');

    const clearOutput = captureOutput();

    try {
      await new RouteClearCommand(app).handle([], {});
    } finally {
      clearOutput.restore();
    }

    expect(clearOutput.logs.join('\n')).toContain('Route cache cleared!');
    expect(existsSync(join(base, 'bootstrap/cache/routes.json'))).toBe(false);
    expect(app.routesAreCached()).toBe(false);
  });

  it('refuses to cache closure routes and leaves no snapshot behind', async () => {
    app.make<Router>('router').get('/closure', () => 'nope');

    const output = captureOutput();

    try {
      await new RouteCacheCommand(app).handle([], {});
    } finally {
      output.restore();
    }

    expect(output.errors.join('\n')).toContain('Uses Closure');
    expect(app.routesAreCached()).toBe(false);
  });

  it('says so when there is no cache to clear', async () => {
    const output = captureOutput();

    try {
      await new RouteClearCommand(app).handle([], {});
    } finally {
      output.restore();
    }

    expect(output.logs.join('\n')).toContain('nothing to clear');
  });
});

describe('key:generate', () => {
  let base: string;
  let app: Application;
  let appKeyBefore: string | undefined;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'orchestr-key-'));
    appKeyBefore = process.env.APP_KEY;
    delete process.env.APP_KEY;
    app = new Application(base);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });

    if (appKeyBefore === undefined) {
      delete process.env.APP_KEY;
    } else {
      process.env.APP_KEY = appKeyBefore;
    }
  });

  it('writes a valid APP_KEY without clobbering the other entries', async () => {
    writeFileSync(
      join(base, '.env'),
      ['APP_NAME=Orchestr', '# a comment stays', 'APP_KEY=old-key', 'DB_PORT=3306'].join('\n') + '\n',
      'utf-8'
    );

    const output = captureOutput();

    try {
      // An existing key is destructive to replace: non-interactive runs
      // must refuse until --force says otherwise.
      await expect(new KeyGenerateCommand(app).handle([], {})).rejects.toThrow(/--force/);
      expect(readFileSync(join(base, '.env'), 'utf-8')).toContain('APP_KEY=old-key');

      await new KeyGenerateCommand(app).handle([], { force: true });
    } finally {
      output.restore();
    }

    const contents = readFileSync(join(base, '.env'), 'utf-8');
    const lines = contents.split('\n');

    expect(contents).toContain('APP_NAME=Orchestr');
    expect(contents).toContain('# a comment stays');
    expect(contents).toContain('DB_PORT=3306');
    expect(contents).not.toContain('old-key');

    const keyLine = lines.find((line) => line.startsWith('APP_KEY='));
    expect(keyLine).toBeDefined();

    const key = (keyLine as string).slice('APP_KEY='.length);
    expect(key.startsWith('base64:')).toBe(true);
    expect(Buffer.from(key.slice('base64:'.length), 'base64')).toHaveLength(32);
    expect(process.env.APP_KEY).toBe(key);
    expect(output.logs.join('\n')).toContain('Application key set successfully');
  });

  it('creates the file entry when no key exists yet, without confirmation', async () => {
    writeFileSync(join(base, '.env'), 'APP_NAME=Orchestr\n', 'utf-8');

    const output = captureOutput();

    try {
      await new KeyGenerateCommand(app).handle([], {});
    } finally {
      output.restore();
    }

    const contents = readFileSync(join(base, '.env'), 'utf-8');

    expect(contents).toContain('APP_NAME=Orchestr');
    expect(contents).toMatch(/^APP_KEY=base64:/m);
  });

  it('--show prints a key and leaves the file alone', async () => {
    writeFileSync(join(base, '.env'), 'APP_NAME=Orchestr\n', 'utf-8');

    const output = captureOutput();

    try {
      await new KeyGenerateCommand(app).handle([], { show: true });
    } finally {
      output.restore();
    }

    expect(output.logs.join('\n')).toMatch(/^base64:/m);
    expect(readFileSync(join(base, '.env'), 'utf-8')).toBe('APP_NAME=Orchestr\n');
  });
});

describe('storage:link', () => {
  let base: string;
  let app: Application;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'orchestr-storage-'));
    mkdirSync(join(base, 'storage/app/public'), { recursive: true });
    mkdirSync(join(base, 'public'), { recursive: true });
    app = new Application(base);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('creates the symlink and is idempotent on re-runs', async () => {
    const first = captureOutput();

    try {
      await new StorageLinkCommand(app).handle([], {});
    } finally {
      first.restore();
    }

    const link = join(base, 'public/storage');

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(realpathSync(link)).toBe(realpathSync(join(base, 'storage/app/public')));

    const second = captureOutput();

    try {
      await new StorageLinkCommand(app).handle([], {});
    } finally {
      second.restore();
    }

    expect(second.logs.join('\n')).toContain('already exists');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('follows the registered public disk root', async () => {
    const custom = join(base, 'var/files');
    mkdirSync(custom, { recursive: true });

    app.instance('filesystem', new FilesystemManager({ disks: { public: { driver: 'local', root: custom } } }, base));

    const output = captureOutput();

    try {
      await new StorageLinkCommand(app).handle([], {});
    } finally {
      output.restore();
    }

    expect(realpathSync(join(base, 'public/storage'))).toBe(realpathSync(custom));
  });

  it('refuses to replace a foreign link without --force, and replaces it with one', async () => {
    const link = join(base, 'public/storage');
    symlinkSync('/somewhere/else', link, 'dir');

    const guarded = captureOutput();

    try {
      await expect(new StorageLinkCommand(app).handle([], {})).rejects.toThrow(/--force/);
    } finally {
      guarded.restore();
    }

    expect(readlinkSync(link)).toBe('/somewhere/else');

    const forced = captureOutput();

    try {
      await new StorageLinkCommand(app).handle([], { force: true });
    } finally {
      forced.restore();
    }

    expect(realpathSync(link)).toBe(realpathSync(join(base, 'storage/app/public')));
  });

  it('fails when the storage target does not exist', async () => {
    rmSync(join(base, 'storage'), { recursive: true, force: true });

    const output = captureOutput();

    try {
      await new StorageLinkCommand(app).handle([], {});
    } finally {
      output.restore();
    }

    expect(output.errors.join('\n')).toContain('does not exist');
    expect(existsSync(join(base, 'public/storage'))).toBe(false);
  });
});

describe('about', () => {
  let base: string;
  let app: Application;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'orchestr-about-'));
    app = new Application(base);
    app.register(
      new ConfigServiceProvider(app, {
        app: { url: 'http://localhost:8000' },
        cache: { default: 'array', stores: { array: { driver: 'array' } }, prefix: 'orchestr_cache' },
        database: { default: 'sqlite', connections: { sqlite: { driver: 'sqlite', database: ':memory:' } } },
        queue: { default: 'sync', connections: { sync: { driver: 'sync' } } },
        filesystems: { default: 'local', disks: { local: { driver: 'local' } } },
        session: { driver: 'file', lifetime: 120, cookie: 'orchestr_session' },
      })
    );
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('reports version, environment, and subsystem drivers', async () => {
    const output = captureOutput();

    try {
      await new AboutCommand(app).handle([], {});
    } finally {
      output.restore();
    }

    const printed = output.logs.join('\n');

    expect(printed).toContain(`Orchestr ${app.version()}`);
    expect(printed).toContain('Environment');
    expect(printed).toContain('Debug Mode');
    expect(printed).toContain('Drivers');
    expect(printed).toContain('http://localhost:8000');
    // Each subsystem surfaces its configured driver, from the config
    // repository when no manager is registered.
    expect(printed).toContain('array (array)');
    expect(printed).toContain('sqlite (sqlite)');
    expect(printed).toContain('sync (sync)');
    expect(printed).toContain('file');
    expect(printed).toContain('120');
  });
});

describe('db:monitor', () => {
  let base: string;
  let app: Application;

  const healthyFakes = () => ({
    db: {
      getDefaultConnection: () => 'main',
      connection: () => ({
        select: async () => [{ health: 1 }],
        getConfig: () => ({ driver: 'sqlite' }),
      }),
    },
    cache: {
      getDefaultDriver: () => 'array',
      store: () => ({
        forget: async () => true,
        forever: async () => true,
        get: async () => 'healthy',
      }),
    },
    queue: {
      getDefaultConnection: () => 'sync',
      connection: () => ({ size: async () => 2 }),
      getConnectionConfig: () => ({ driver: 'sync', queue: 'default' }),
    },
  });

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'orchestr-monitor-'));
    app = new Application(base);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('reports the health of every registered subsystem', async () => {
    const fakes = healthyFakes();
    app.instance('db', fakes.db);
    app.instance('cache', fakes.cache);
    app.instance('queue', fakes.queue);

    const output = captureOutput();

    try {
      await new DbMonitorCommand(app).handle([], {});
    } finally {
      output.restore();
    }

    const printed = output.logs.join('\n');

    expect(printed).toContain('Database');
    expect(printed).toContain('OK');
    expect(printed).toContain('sqlite');
    expect(printed).toContain('2 pending job(s)');
  });

  it('fails the run when a subsystem is unhealthy', async () => {
    const fakes = healthyFakes();
    (fakes.db as any).connection = () => ({
      select: async () => {
        throw new Error('connection refused');
      },
      getConfig: () => ({ driver: 'mysql' }),
    });
    app.instance('db', fakes.db);

    const output = captureOutput();

    try {
      await expect(new DbMonitorCommand(app).handle([], {})).rejects.toThrow(/health checks failed/);
    } finally {
      output.restore();
    }

    const printed = output.logs.join('\n');

    expect(printed).toContain('FAIL');
    expect(printed).toContain('connection refused');
  });

  it('says so when nothing is registered to monitor', async () => {
    const output = captureOutput();

    try {
      await new DbMonitorCommand(app).handle([], {});
    } finally {
      output.restore();
    }

    expect(output.logs.join('\n')).toContain('nothing to monitor');
  });
});

describe('destructive command confirmation', () => {
  let base: string;
  let app: Application;
  let dropSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'orchestr-destructive-'));
    app = new Application(base);
    app.instance('db', {
      getDefaultConnection: () => 'main',
      connection: () => ({ getConfig: () => ({ driver: 'sqlite' }) }),
    });

    dropSpy = vi.spyOn(Migrator.prototype, 'dropAllTables').mockResolvedValue(undefined);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('db:wipe refuses to run non-interactively without --force', async () => {
    const output = captureOutput();

    try {
      await expect(new DbWipeCommand(app).handle([], {})).rejects.toThrow(/--force/);
    } finally {
      output.restore();
    }

    expect(dropSpy).not.toHaveBeenCalled();
  });

  it('db:wipe drops every table when forced', async () => {
    const output = captureOutput();

    try {
      await new DbWipeCommand(app).handle([], { force: true });
    } finally {
      output.restore();
    }

    expect(dropSpy).toHaveBeenCalledTimes(1);
    expect(output.logs.join('\n')).toContain('Database wiped successfully');
  });
});

describe('serve', () => {
  let base: string;
  let app: Application;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'orchestr-serve-'));
    app = new Application(base);
    app.singleton('router', () => new Router(app));
    app.make<Router>('router').get('/ping', () => 'pong');
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('starts the HTTP kernel on the configured host/port and stops cleanly', async () => {
    const output = captureOutput();
    const command = new ServeCommand(app);
    const port = 18_234;

    try {
      const running = command.handle([], { host: '127.0.0.1', port: String(port) });

      const server = await waitFor(() => {
        const active = command.getServer();

        return active !== null && active.listening ? active : null;
      });
      expect((server.address() as { port: number }).port).toBe(port);

      const response = await fetch(`http://127.0.0.1:${port}/ping`, { headers: { connection: 'close' } });
      expect(await response.text()).toBe('pong');
      expect(output.logs.join('\n')).toContain(`http://127.0.0.1:${port}`);

      await command.stop();
      await running;

      expect(command.getServer()).toBeNull();
    } finally {
      output.restore();
    }
  }, 15_000);
});

/**
 * Poll for a truthy value on a short timer (no fake timers here: the HTTP
 * server needs the real event loop).
 */
async function waitFor<T>(probe: () => T | null, timeoutMs: number = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = probe();

    if (value !== null && value !== undefined) {
      return value as T;
    }

    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the probe to succeed.');
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('model:show', () => {
  let base: string;
  let app: Application;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'orchestr-modelshow-'));
    app = new Application(base);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('renders table, attributes, and casts for a container-bound model', async () => {
    const { Ensemble } = await import('@/Database/Ensemble/Ensemble');

    class Post extends Ensemble {
      static fillable = ['title', 'body'];
      static casts = { body: 'json' };
    }

    app.instance('Post', new Post());

    const output = captureOutput();

    try {
      await new ModelShowCommand(app).handle(['Post'], {});
    } finally {
      output.restore();
    }

    const printed = output.logs.join('\n');

    expect(printed).toContain('Model: Post');
    expect(printed).toContain('posts'); // table name
    expect(printed).toContain('title');
    expect(printed).toContain('body');
    expect(printed).toContain('json'); // cast
    expect(printed).toContain('Relations (0)');
    // No database is registered, so the row count degrades gracefully.
    expect(printed).toContain('unavailable');
  });

  it('errors for an unresolvable model name', async () => {
    const output = captureOutput();

    try {
      await new ModelShowCommand(app).handle(['NoSuchModel'], {});
    } finally {
      output.restore();
    }

    expect(output.errors.join('\n')).toContain('NoSuchModel');
  });
});

describe('optimize / optimize:clear', () => {
  let base: string;
  let app: Application;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'orchestr-optimize-'));
    mkdirSync(join(base, 'config'), { recursive: true });
    writeFileSync(join(base, 'config', 'app.json'), JSON.stringify({ name: 'Optimize Fixture' }), 'utf-8');
    app = new Application(base);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('runs the config cache and skips subsystems that are not registered', async () => {
    const output = captureOutput();

    try {
      await new OptimizeCommand(app).handle([], {});
    } finally {
      output.restore();
    }

    const printed = output.logs.join('\n');

    // Composes the config:cache command, so that command's own report shows.
    expect(printed).toContain('Configuration cached successfully!');
    expect(existsSync(join(base, 'bootstrap/cache/config.json'))).toBe(true);
    expect(printed).toContain('Skipping [route:cache]');
    expect(printed).toContain('Skipping [view:cache]');
  });

  it('clears the caches optimize wrote', async () => {
    const up = captureOutput();

    try {
      await new OptimizeCommand(app).handle([], {});
    } finally {
      up.restore();
    }

    const output = captureOutput();

    try {
      await new OptimizeClearCommand(app).handle([], {});
    } finally {
      output.restore();
    }

    expect(output.logs.join('\n')).toContain('Configuration cache cleared!');
    expect(existsSync(join(base, 'bootstrap/cache/config.json'))).toBe(false);
  });
});
