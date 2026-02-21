import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Facade, createFacade } from '@/Support/Facade';
import { Application } from '@/Foundation/Application';

class TestService {
  greet(name: string): string {
    return `Hello, ${name}!`;
  }

  getValue(): number {
    return 42;
  }
}

describe('Facade', () => {
  let app: Application;

  beforeEach(() => {
    app = new Application('/test');
    app.instance('test-service', new TestService());
    Facade.setFacadeApplication(app);
  });

  afterEach(() => {
    Facade.clearResolvedInstances();
  });

  describe('setFacadeApplication()', () => {
    it('sets the application instance', () => {
      expect(Facade.getFacadeApplication()).toBe(app);
    });
  });

  describe('clearResolvedInstance()', () => {
    it('clears a specific resolved instance', () => {
      // Create a facade, resolve it, clear it
      const TestFacade = createFacade<TestService>('test-service');
      (TestFacade as any).greet('World'); // resolve
      Facade.clearResolvedInstance('test-service');
      // Should re-resolve
      expect((TestFacade as any).greet('World')).toBe('Hello, World!');
    });
  });

  describe('clearResolvedInstances()', () => {
    it('clears all resolved instances', () => {
      Facade.clearResolvedInstances();
      // No error should occur
    });
  });

  describe('getFacadeAccessor() error', () => {
    it('throws if not overridden', () => {
      class BadFacade extends Facade {}
      expect(() => (BadFacade as any).getFacadeAccessor()).toThrow(
        'Facade does not implement getFacadeAccessor method'
      );
    });
  });
});

describe('createFacade()', () => {
  let app: Application;

  beforeEach(() => {
    app = new Application('/test');
    app.instance('test-service', new TestService());
    Facade.setFacadeApplication(app);
  });

  afterEach(() => {
    Facade.clearResolvedInstances();
  });

  it('creates a proxy facade that calls methods on the root', () => {
    const TestFacade = createFacade<TestService>('test-service');
    expect((TestFacade as any).greet('World')).toBe('Hello, World!');
  });

  it('proxies property access', () => {
    const TestFacade = createFacade<TestService>('test-service');
    expect((TestFacade as any).getValue()).toBe(42);
  });

  it('throws when no app is set', () => {
    Facade.setFacadeApplication(undefined as any);
    const TestFacade = createFacade<TestService>('test-service');
    expect(() => (TestFacade as any).greet('World')).toThrow('facade root has not been set');
  });
});
