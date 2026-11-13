/**
 * Config facade
 *
 * The Config facade must forward static-looking calls to the container's
 * 'config' repository at runtime - it was previously a type-only cast with
 * no Proxy, so Config.get(...) threw "is not a function" despite compiling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Config } from '@/Facades/Config';
import { Application } from '@/Foundation/Application';
import { Config as ConfigClass } from '@/Foundation/Config/Config';
import { Facade } from '@/Support/Facade';

describe('Config facade', () => {
  let app: Application;

  beforeEach(() => {
    app = new Application('/test');
    app.instance('config', new ConfigClass({ app: { name: 'Facade Test' }, nested: { a: 1 } }));
    Facade.setFacadeApplication(app);
    Facade.clearResolvedInstances();
  });

  afterEach(() => {
    Facade.clearResolvedInstances();
  });

  it('forwards get/has/set/all to the bound repository', () => {
    expect(Config.get('app.name')).toBe('Facade Test');
    expect(Config.has('nested.a')).toBe(true);
    expect(Config.all().nested).toEqual({ a: 1 });

    Config.set('nested.b', 2);
    expect(app.make<ConfigClass>('config').get('nested.b')).toBe(2);
  });

  it('passes default values through', () => {
    expect(Config.get('missing.key', 'fallback')).toBe('fallback');
  });

  it('resolves against a live container swap', () => {
    app.instance('config', new ConfigClass({ app: { name: 'Swapped' } }));
    Facade.clearResolvedInstance('config');
    expect(Config.get('app.name')).toBe('Swapped');
  });
});
