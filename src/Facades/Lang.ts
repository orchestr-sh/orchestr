/**
 * Lang Facade - Static access to the translator
 * Illuminate\Support\Facades\Lang
 *
 * Like every other facade this is a runtime Proxy over the container's
 * 'translator' binding (the Translator registered by
 * TranslationServiceProvider); static-looking calls such as
 * `Lang.get('messages.welcome')` forward to the resolved instance. With
 * no application bound, the facade answers from the process-wide default
 * translator, so `Lang.get('unknown.key')` returns the key instead of
 * crashing standalone scripts - the same graceful fallback the `__()`
 * helper performs.
 *
 * @example
 * ```typescript
 * import { Lang } from '@orchestr-sh/orchestr/Facades';
 *
 * Lang.get('messages.greeting', { name: 'Sam' }); // 'Hello, Sam!'
 * Lang.choice('messages.apples', 2); // 'There are 2 apples'
 * Lang.setLocale('fr');
 * ```
 */

import type { Translator } from '@/Translation/Translator';
import { Facade } from '@/Support/Facade';
import { defaultTranslator } from '@/Translation/Translator';

class LangFacade extends Facade {
  protected static getFacadeAccessor(): string {
    return 'translator';
  }
}

/**
 * The active translator: the container's 'translator' binding when an
 * application registered one, the process-wide default otherwise.
 */
function resolveTranslator(): Translator {
  try {
    const app = Facade.getFacadeApplication();

    if (app && app.bound('translator')) {
      return app.make<Translator>('translator');
    }
  } catch {
    // Fall through to the default translator.
  }

  return defaultTranslator();
}

export const Lang = new Proxy(LangFacade, {
  get(target, prop) {
    // Statics on the facade class itself come first.
    if (prop in target) {
      const value = (target as any)[prop];

      if (typeof value === 'function') {
        return value.bind(target);
      }

      return value;
    }

    const root = resolveTranslator() as Translator;

    const value = (root as any)[prop];

    if (typeof value === 'function') {
      return (...args: any[]) => value.apply(root, args);
    }

    return value;
  },
}) as unknown as typeof LangFacade & Translator;
