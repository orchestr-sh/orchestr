import { describe, it, expect, beforeEach } from 'vitest';
import { Application } from '@/Foundation/Application';
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
    it('returns version', () => {
      expect(app.version()).toBe('0.1.0');
    });

    it('returns environment file', () => {
      expect(app.environmentFile()).toBe('.env');
    });

    it('returns environment', () => {
      expect(typeof app.environment()).toBe('string');
    });

    it('returns runningInConsole', () => {
      expect(typeof app.runningInConsole()).toBe('boolean');
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
