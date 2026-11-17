/**
 * HTTP client - container integration
 *
 * HttpServiceProvider binds the `http` key; the facade and the http()
 * helper resolve it when an application provides one, and the facade
 * falls back to the process-wide default factory when none exists (so
 * scripts and tests can fake outbound HTTP without booting).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Http } from '@/Facades/Http';
import { Application } from '@/Foundation/Application';
import { Factory } from '@/Http/Client/Factory';
import { HttpServiceProvider } from '@/Http/Client/HttpServiceProvider';
import { Facade } from '@/Support/Facade';
import { http } from '@/Support/helpers';

describe('HttpServiceProvider', () => {
  let app: Application;

  beforeEach(() => {
    app = new Application();
    app.register(HttpServiceProvider);
    Facade.setFacadeApplication(app);
  });

  afterEach(() => {
    Http.stopFaking();
    app.make<Factory>('http').stopFaking();
    Facade.setFacadeApplication(undefined as any);
  });

  it('binds a fresh factory under the http key', () => {
    expect(app.bound('http')).toBe(true);
    expect(app.make('http')).toBeInstanceOf(Factory);
    expect(app.make('http')).toBe(app.make('http')); // singleton
  });

  it('the facade and the http() helper talk to the bound factory', async () => {
    const factory = app.make<Factory>('http');

    expect(http()).toBe(factory);

    Http.fake({ 'https://bound.test/*': { bound: true } });

    const response = await Http.get('https://bound.test/thing');

    expect(response.json('bound')).toBe(true);

    // Assertions are available on both entry points.
    Http.assertSent('https://bound.test/thing');
    factory.assertSent((request) => request.url === 'https://bound.test/thing');
  });

  it('without an application the facade uses the process-wide default', async () => {
    Facade.setFacadeApplication(undefined as any);

    Http.fake({ 'https://standalone.test/*': { standalone: true } });

    const response = await Http.get('https://standalone.test/');

    expect(response.json('standalone')).toBe(true);
    Http.assertSent('https://standalone.test/');
  });
});
