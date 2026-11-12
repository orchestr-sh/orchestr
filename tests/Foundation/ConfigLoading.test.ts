/**
 * Configuration file loading and snapshot caching.
 *
 * Covers the ConfigLoader sources (config/*.ts, *.js, *.json), the
 * ConfigServiceProvider merge semantics, and the config:cache / config:clear
 * round-trip including the APP_CONFIG_CACHE override.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigCacheCommand } from '@/Console/Commands/ConfigCacheCommand';
import { ConfigClearCommand } from '@/Console/Commands/ConfigClearCommand';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { ConfigLoader } from '@/Foundation/Config/ConfigLoader';
import { ConfigServiceProvider } from '@/Foundation/Config/ConfigServiceProvider';
import { Env } from '@/Foundation/Env/Env';
import { config } from '@/Support/helpers';

const FIXTURES = join(process.cwd(), 'tests/Foundation/fixtures');

function repository(app: Application): Config {
  return app.make<Config>('config');
}

describe('ConfigLoader', () => {
  it('loads config/*.ts, config/*.js and config/*.json keyed by file basename', async () => {
    const app = new Application(join(FIXTURES, 'configapp'));
    const loaded = await new ConfigLoader(app).loadFiles();

    expect(Object.keys(loaded).sort()).toEqual(['app', 'cache', 'database']);
    expect(loaded.database).toEqual({
      default: 'mysql',
      connections: {
        mysql: { driver: 'mysql', host: '127.0.0.1', database: 'orchestr' },
      },
    });
    expect(loaded.app).toEqual({ name: 'Config Fixture App', url: 'http://localhost' });
    expect(loaded.cache).toEqual({ default: 'file' });
  });

  it('only loads top-level config files', async () => {
    const app = new Application(join(FIXTURES, 'configapp'));
    const loaded = await new ConfigLoader(app).loadFiles();

    expect('nested' in loaded).toBe(false);
    expect('sub/nested' in loaded).toBe(false);
  });

  it('returns an empty record when the config directory is missing', async () => {
    const app = new Application(join(FIXTURES, 'no-such-app'));

    expect(await new ConfigLoader(app).loadFiles()).toEqual({});
  });

  it('rejects non-serializable values when caching', async () => {
    const app = new Application(join(FIXTURES, 'strictapp'));
    const loader = new ConfigLoader(app);
    const items = await loader.loadFiles();

    expect(() => loader.cache(items)).toThrow(/hooks\.before/);
    expect(existsSync(app.getCachedConfigPath())).toBe(false);
  });
});

describe('ConfigServiceProvider', () => {
  it('merges config files over inline values during boot', async () => {
    const app = new Application(join(FIXTURES, 'configapp'));
    app.register(new ConfigServiceProvider(app, { app: { name: 'inline name' }, seeded: { keep: true } }));
    await app.boot();

    const repo = repository(app);

    expect(repo.get('database.connections.mysql.host')).toBe('127.0.0.1');
    expect(repo.get('app.name')).toBe('Config Fixture App');
    expect(repo.get('seeded.keep')).toBe(true);
  });

  it('is auto-registered by Application.boot()', async () => {
    const app = new Application(join(FIXTURES, 'configapp'));
    await app.boot();

    expect(app.isBooted()).toBe(true);
    expect(repository(app).get('database.default')).toBe('mysql');
  });

  it('exposes config/database.ts through the config() helper', async () => {
    const app = new Application(join(FIXTURES, 'configapp'));
    await app.boot();

    expect(config('database')).toEqual({
      default: 'mysql',
      connections: {
        mysql: { driver: 'mysql', host: '127.0.0.1', database: 'orchestr' },
      },
    });
    expect(config('database.default')).toBe('mysql');
  });
});

describe('config:cache / config:clear', () => {
  let workspace: string;
  let app: Application;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'orchestr-config-cache-'));
    mkdirSync(join(workspace, 'config'), { recursive: true });
    writeFileSync(join(workspace, 'config', 'queue.json'), JSON.stringify({ default: 'sync' }), 'utf-8');

    app = new Application(workspace);
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('writes a serializable snapshot to bootstrap/cache/config.json', async () => {
    await new ConfigCacheCommand(app).handle();

    const path = join(workspace, 'bootstrap', 'cache', 'config.json');
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ queue: { default: 'sync' } });
  });

  it('boots from the cached snapshot instead of the config files', async () => {
    await new ConfigCacheCommand(app).handle();

    // Change the source file after caching: the snapshot must win.
    writeFileSync(join(workspace, 'config', 'queue.json'), JSON.stringify({ default: 'redis' }), 'utf-8');

    const fresh = new Application(workspace);
    await fresh.boot();

    expect(repository(fresh).get('queue.default')).toBe('sync');
  });

  it('config:clear removes the snapshot so files are used again', async () => {
    await new ConfigCacheCommand(app).handle();

    // Change the source after caching; only a cleared cache makes this visible.
    writeFileSync(join(workspace, 'config', 'queue.json'), JSON.stringify({ default: 'redis' }), 'utf-8');

    await new ConfigClearCommand(app).handle();

    expect(existsSync(join(workspace, 'bootstrap', 'cache', 'config.json'))).toBe(false);

    const fresh = new Application(workspace);
    await fresh.boot();

    expect(repository(fresh).get('queue.default')).toBe('redis');
  });

  it('honours APP_CONFIG_CACHE for an explicit snapshot path', async () => {
    const custom = join(workspace, 'generated', 'config-cache.json');
    Env.set('APP_CONFIG_CACHE', custom);

    try {
      await new ConfigCacheCommand(app).handle();

      expect(existsSync(custom)).toBe(true);
      expect(existsSync(join(workspace, 'bootstrap', 'cache', 'config.json'))).toBe(false);

      const fresh = new Application(workspace);
      expect(fresh.configurationIsCached()).toBe(true);
      expect(fresh.getCachedConfigPath()).toBe(custom);
    } finally {
      Env.forget('APP_CONFIG_CACHE');
    }
  });

  it('reports when there is nothing to clear', async () => {
    await new ConfigClearCommand(app).handle();
    expect(existsSync(join(workspace, 'bootstrap', 'cache', 'config.json'))).toBe(false);
  });

  it('caches nothing when no config files exist', async () => {
    const emptyApp = new Application(join(workspace, 'empty'));

    await new ConfigCacheCommand(emptyApp).handle();

    expect(JSON.parse(readFileSync(emptyApp.getCachedConfigPath(), 'utf-8'))).toEqual({});
  });
});
