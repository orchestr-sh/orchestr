/**
 * SetLocale middleware - select the locale from `Accept-Language`
 * Illuminate\Foundation\Http\Middleware\SetLocale
 *
 * Parses the request's `Accept-Language` header (q-values, wildcard
 * entries included) and switches the container's translator to the best
 * supported locale: an exact (case-insensitive) tag match first, then a
 * primary-subtag match so `en-GB` lands on an `en` translation set. A
 * locale the translator knows nothing about never sticks - the
 * configured `app.locale` stays in place.
 *
 * Module-based language files for the new locale are awaited before the
 * request continues, so validation messages and `__()` calls inside the
 * route all speak the selected locale.
 *
 * @example
 * ```typescript
 * kernel.use(SetLocale);
 *
 * // or behind an alias
 * kernel.middlewareAlias('locale', SetLocale);
 * Route.get('/dashboard', show).middleware('locale');
 * ```
 */

import type { Middleware } from '@/Routing/Pipeline';
import type { Translator } from '@/Translation/Translator';
import { getGlobalApp } from '@/Support/helpers';

/**
 * One parsed `Accept-Language` entry.
 */
export interface AcceptLanguageEntry {
  /** Raw language tag, e.g. `en-GB`. */
  locale: string;
  /** Quality weight (default 1); higher preference wins. */
  quality: number;
}

/**
 * Parse an `Accept-Language` header into entries ordered by q-value
 * (stable, preserving header order for equal weights).
 * Laravel/Symfony: Request::getAcceptableLanguages()
 */
export function parseAcceptLanguage(header: string): AcceptLanguageEntry[] {
  const entries: AcceptLanguageEntry[] = [];

  for (const part of header.split(',')) {
    const [tag, ...parameters] = part.trim().split(';');

    if (!tag) {
      continue;
    }

    let quality = 1;
    let valid = true;

    for (const parameter of parameters) {
      const [name, rawValue] = parameter.split('=');

      if (name?.trim().toLowerCase() === 'q') {
        const parsed = Number.parseFloat((rawValue ?? '').trim());

        if (Number.isNaN(parsed)) {
          valid = false;
        } else {
          quality = parsed;
        }
      }
    }

    if (valid) {
      entries.push({ locale: tag.trim(), quality });
    }
  }

  return entries.sort((left, right) => right.quality - left.quality);
}

/**
 * Pick the best supported locale for the parsed preferences: exact tag
 * match first, then primary-subtag match (`fr-CA` -> `fr`). Returns null
 * when nothing the client offered is supported.
 */
export function matchSupportedLocale(preferences: AcceptLanguageEntry[], supported: string[]): string | null {
  const lowercased = new Map<string, string>();

  for (const locale of supported) {
    lowercased.set(locale.toLowerCase(), locale);
  }

  for (const preference of preferences) {
    const tag = preference.locale.toLowerCase();

    if (tag === '*') {
      continue;
    }

    const exact = lowercased.get(tag);

    if (exact !== undefined) {
      return exact;
    }

    // Region folding: en-GB / en_UK answer to the `en` line set
    const primary = tag.split(/[-_]/)[0];

    for (const [locale, original] of lowercased) {
      if (locale.split(/[-_]/)[0] === primary) {
        return original;
      }
    }
  }

  return null;
}

/**
 * Resolve the translator the middleware should drive from the container
 */
export function resolveTranslatorForLocale(): Translator | null {
  const app = getGlobalApp();

  if (!app || !app.bound('translator')) {
    return null;
  }

  return app.make<Translator>('translator');
}

/**
 * Build a locale middleware; the resolver is the seam for testing and
 * for apps that keep their own Translator instance
 */
export function makeSetLocale(translator?: () => Translator | null): Middleware {
  const middleware: Middleware = async (req, _res, next) => {
    const target = translator ? translator() : resolveTranslatorForLocale();
    const header = req.header('accept-language');

    if (target && header) {
      const preferences = parseAcceptLanguage(header);
      const match = matchSupportedLocale(preferences, target.locales());

      if (match !== null && match !== target.getLocale()) {
        // Warm the locale first so module-based files answer the request
        await target.preload(match);
        target.setLocale(match);
      }
    }

    return next();
  };

  return middleware;
}

/**
 * The container-driven Accept-Language middleware, ready for the
 * Kernel's global stack, an alias or a route group
 */
export const SetLocale: Middleware = async (req, res, next) => await makeSetLocale()(req, res, next);
