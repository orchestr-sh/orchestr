/**
 * Http Facade
 *
 * Static access to the HTTP client: fluent configuration and verbs
 * (`Http.withToken('secret').get(url)`), faking outbound requests
 * (`Http.fake({...})` + `Http.assertSent(...)`), and transport
 * swapping (`Http.setTransport(...)`).
 *
 * The facade resolves the `http` container binding when an
 * application registered one (via HttpServiceProvider); with no
 * binding present it falls back to the process-wide default factory,
 * so standalone scripts and tests can use `Http.fake()` without
 * booting anything.
 *
 * @example
 * ```typescript
 * import { Http } from '@orchestr-sh/orchestr/Facades';
 *
 * Http.fake({ 'https://api.example.com/*': { data: { name: 'Ada' } } });
 *
 * const response = await Http.withToken('secret').acceptJson().get('https://api.example.com/me');
 *
 * response.json('data.name'); // 'Ada'
 * Http.assertSent('https://api.example.com/me');
 * ```
 */

import type { Factory } from '@/Http/Client/Factory';
import { defaultFactory } from '@/Http/Client/Factory';
import { Facade } from '@/Support/Facade';

class HttpFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'http';
  }
}

/**
 * The active factory: the container's `http` binding when present,
 * the process-wide default otherwise.
 */
function resolveFactory(): Factory {
  try {
    const app = Facade.getFacadeApplication();

    if (app && app.bound('http')) {
      return app.make<Factory>('http');
    }
  } catch {
    // Fall through to the default factory.
  }

  return defaultFactory();
}

export const Http = new Proxy(HttpFacadeClass, {
  get(target, prop) {
    // Statics on the facade class itself come first.
    if (prop in target) {
      const value = (target as any)[prop];

      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    }

    // Everything else runs against the factory (Fake methods and
    // assertions included).
    const root = resolveFactory() as Factory;

    const value = (root as any)[prop];

    if (typeof value === 'function') {
      return (...args: any[]) => value.apply(root, args);
    }

    return value;
  },
}) as unknown as typeof HttpFacadeClass & Factory;
