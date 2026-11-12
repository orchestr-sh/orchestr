import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, beforeEach, expect, it } from 'vitest';
import { Application } from '@/Foundation/Application';
import { Env } from '@/Foundation/Env/Env';
import { ServiceProvider } from '@/Foundation/ServiceProvider';

class TestProvider extends ServiceProvider {
  public registered = false;
  public booted = false;

  register(): void {
    this.registered = true;
    this.app.instance('test-service', { name: 'test' });
  }

  boot(): void {
    this.booted = true;
  }
}

class AsyncBootProvider extends ServiceProvider {
  public booted = false;

  register(): void {}

  async boot(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.booted = true;
  }
}

describe('Application', () => {
  let app: Application;

  beforeEach(() => {
    app = new Application('/test/base');
  });

  describe('constructor', () => {
    it('extends Container', () => {
      expect(app.make('app')).toBe(app);
    });

    it('registers base bindings', () => {
      expect(app.make('app')).toBe(app);
      expect(app.make(Application)).toBe(app);
    });

    it('uses provided base path', () => {
      expect(app.getBasePath()).toBe('/test/base');
    });

    it('defaults base path to cwd', () => {
      const defaultApp = new Application();
      expect(defaultApp.getBasePath()).toBe(process.cwd());
    });
  });

  describe('path helpers', () => {
    it('returns app path', () => {
      expect(app.path()).toBe('/test/base/app');
      expect(app.path('Models')).toBe('/test/base/app/Models');
    });

    it('returns config path', () => {
      expect(app.configPath()).toBe('/test/base/config');
      expect(app.configPath('app.ts')).toBe('/test/base/config/app.ts');
    });

    it('returns database path', () => {
      expect(app.databasePath()).toBe('/test/base/database');
      expect(app.databasePath('migrations')).toBe('/test/base/database/migrations');
    });

    it('returns storage path', () => {
      expect(app.storagePath()).toBe('/test/base/storage');
    });

    it('returns public path', () => {
      expect(app.publicPath()).toBe('/test/base/public');
    });
  });

  describe('setBasePath()', () => {
    it('changes the base path', () => {
      app.setBasePath('/new/path');
      expect(app.getBasePath()).toBe('/new/path');
    });

    it('returns the application for chaining', () => {
      const result = app.setBasePath('/new');
      expect(result).toBe(app);
    });
  });

  describe('register()', () => {
    it('registers a service provider instance', () => {
      const provider = new TestProvider(app);
      app.register(provider);
      expect(provider.registered).toBe(true);
    });

    it('registers a service provider class', () => {
      app.register(TestProvider);
      expect(app.make('test-service')).toEqual({ name: 'test' });
    });

    it('does not register the same provider twice', () => {
      const provider = new TestProvider(app);
      app.register(provider);
      app.register(provider);
      expect(app.getProviders().length).toBe(1);
    });

    it('boots provider if application is already booted', async () => {
      await app.boot();
      const provider = new TestProvider(app);
      app.register(provider);
      expect(provider.booted).toBe(true);
    });

    it('returns the provider instance', () => {
      const result = app.register(TestProvider);
      expect(result).toBeInstanceOf(TestProvider);
    });
  });

  describe('registerProviders()', () => {
    it('registers multiple providers', () => {
      app.registerProviders([TestProvider]);
      expect(app.getProviders().length).toBe(1);
    });
  });

  describe('boot()', () => {
    it('boots all registered providers', async () => {
      const provider = new TestProvider(app);
      app.register(provider);
      await app.boot();
      expect(provider.booted).toBe(true);
    });

    it('handles async boot methods', async () => {
      const provider = new AsyncBootProvider(app);
      app.register(provider);
      await app.boot();
      expect(provider.booted).toBe(true);
    });

    it('only boots once', async () => {
      let bootCount = 0;
      class CountingProvider extends ServiceProvider {
        register(): void {}
        boot(): void {
          bootCount++;
        }
      }
      app.register(new CountingProvider(app));
      await app.boot();
      await app.boot();
      expect(bootCount).toBe(1);
    });

    it('sets booted flag', async () => {
      expect(app.isBooted()).toBe(false);
      await app.boot();
      expect(app.isBooted()).toBe(true);
    });
  });

  describe('terminating', () => {
    it('registers and calls terminating callbacks', () => {
      let called = false;
      app.terminating(() => {
        called = true;
      });
      app.terminate();
      expect(called).toBe(true);
    });

    it('calls multiple terminating callbacks', () => {
      const calls: number[] = [];
      app.terminating(() => calls.push(1));
      app.terminating(() => calls.push(2));
      app.terminate();
      expect(calls).toEqual([1, 2]);
    });
  });

  describe('environment helpers', () => {
    const managedKeys = ['APP_ENV', 'NODE_ENV', 'APP_DEBUG', 'FROM_BASE', 'FROM_EXTRA', 'SHARED'];
    let snapshot: Record<string, string | undefined>;

    beforeEach(() => {
      snapshot = {};
      for (const key of managedKeys) {
        snapshot[key] = process.env[key];
      }
    });

    afterEach(() => {
      for (const key of managedKeys) {
        if (snapshot[key] === undefined) {
          Env.forget(key);
        } else {
          process.env[key] = snapshot[key];
        }
      }
    });

    it('reads the version from package.json', () => {
      const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));

      expect(app.version()).toBe(pkg.version);
    });

    it('returns environment file', () => {
      expect(app.environmentFile()).toBe('.env');
    });

    it('prefers APP_ENV over NODE_ENV', () => {
      Env.set('APP_ENV', 'local');
      Env.set('NODE_ENV', 'production');

      expect(app.environment()).toBe('local');
    });

    it('falls back to NODE_ENV, then production', () => {
      Env.forget('APP_ENV');
      Env.set('NODE_ENV', 'development');
      expect(app.environment()).toBe('development');

      Env.forget('APP_ENV');
      Env.forget('NODE_ENV');
      expect(app.environment()).toBe('production');
    });

    it('compares the current environment against names', () => {
      Env.set('APP_ENV', 'testing');

      expect(app.environment('local', 'testing')).toBe(true);
      expect(app.environment('production')).toBe(false);
    });

    it('supports wildcard patterns in environment()', () => {
      Env.set('APP_ENV', 'staging-eu');

      expect(app.environment('staging*', 'production')).toBe(true);
    });

    it('reports local/production/testing flags', () => {
      Env.set('APP_ENV', 'local');
      expect(app.isLocal()).toBe(true);
      expect(app.isProduction()).toBe(false);
      expect(app.isTesting()).toBe(false);

      Env.set('APP_ENV', 'production');
      expect(app.isProduction()).toBe(true);
      expect(app.isLocal()).toBe(false);

      Env.set('APP_ENV', 'testing');
      expect(app.isTesting()).toBe(true);
      expect(app.isProduction()).toBe(false);
    });

    it('reads debug mode from APP_DEBUG', () => {
      Env.forget('APP_DEBUG');
      expect(app.isDebug()).toBe(false);

      Env.set('APP_DEBUG', 'true');
      expect(app.isDebug()).toBe(true);

      Env.set('APP_DEBUG', 'false');
      expect(app.isDebug()).toBe(false);
    });

    it('bootstraps .env and .env.{APP_ENV} from the base path', () => {
      const root = mkdtempSync(join(tmpdir(), 'orchestr-application-env-'));

      try {
        writeFileSync(join(root, '.env'), 'APP_ENV=local\nFROM_BASE=base-value\nSHARED=from-base\n');
        writeFileSync(join(root, '.env.local'), 'FROM_BASE=specific-value\nFROM_EXTRA=yes\n');

        const envApp = new Application(root);

        expect(envApp.hasBeenBootstrapped()).toBe(true);
        expect(envApp.environment()).toBe('local');
        expect(envApp.isLocal()).toBe(true);
        expect(Env.get('FROM_BASE')).toBe('specific-value');
        expect(Env.get('FROM_EXTRA')).toBe('yes');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('does not let .env override real process variables during bootstrap', () => {
      const root = mkdtempSync(join(tmpdir(), 'orchestr-application-env-'));

      try {
        process.env.SHARED = 'from-process';
        writeFileSync(join(root, '.env'), 'SHARED=from-file\nFROM_BASE=irrelevant\n');

        new Application(root);

        expect(Env.get('SHARED')).toBe('from-process');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('detects console execution from CLI-style arguments', () => {
      const originalArgv = process.argv;

      try {
        process.argv = ['/usr/bin/node', '/app/server.js'];
        expect(new Application('/test/base').runningInConsole()).toBe(false);

        process.argv = ['/usr/bin/node', '/app/orchestr.mjs', 'migrate'];
        expect(new Application('/test/base').runningInConsole()).toBe(true);
      } finally {
        process.argv = originalArgv;
      }
    });

    it('honours an explicit console mode marker', () => {
      app.setRunningInConsole(false);
      expect(app.runningInConsole()).toBe(false);

      app.setRunningInConsole(true);
      expect(app.runningInConsole()).toBe(true);
    });
  });

  describe('withEvents()', () => {
    it('sets event discovery paths', () => {
      app.withEvents({ discover: ['/path/a', '/path/b'] });
      expect(app.getEventDiscoveryPaths()).toEqual(['/path/a', '/path/b']);
    });

    it('defaults to app/Listeners', () => {
      expect(app.getEventDiscoveryPaths()).toEqual(['/test/base/app/Listeners']);
    });

    it('returns the application for chaining', () => {
      const result = app.withEvents({});
      expect(result).toBe(app);
    });
  });
});
