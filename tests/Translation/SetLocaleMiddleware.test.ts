/**
 * SetLocale middleware - Accept-Language negotiation per request
 */

import { createRawRequest, handle } from '@tests/Session/support';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { Application } from '@/Foundation/Application';
import { Kernel } from '@/Foundation/Http/Kernel';
import { makeSetLocale, matchSupportedLocale, parseAcceptLanguage, SetLocale } from '@/Routing/Middleware/SetLocale';
import { Request } from '@/Routing/Request';
import { Response } from '@/Routing/Response';
import { Router } from '@/Routing/Router';
import { FileLoader } from '@/Translation/FileLoader';
import { TranslationServiceProvider } from '@/Translation/TranslationServiceProvider';
import { Translator } from '@/Translation/Translator';

const LANG = join(process.cwd(), 'tests/Translation/fixtures/lang');

function makeRequest(acceptLanguage?: string): Request {
  return new Request(
    createRawRequest('GET', '/', acceptLanguage === undefined ? {} : { headers: { 'accept-language': acceptLanguage } })
  );
}

const response = {} as Response;

describe('parseAcceptLanguage', () => {
  it('parses tags with q-values in preference order', () => {
    expect(parseAcceptLanguage('en-GB,en;q=0.9,fr-FR;q=0.8')).toEqual([
      { locale: 'en-GB', quality: 1 },
      { locale: 'en', quality: 0.9 },
      { locale: 'fr-FR', quality: 0.8 },
    ]);
  });

  it('sorts by quality, keeping header order for ties', () => {
    const entries = parseAcceptLanguage('de;q=0.3,fr;q=0.9,en;q=0.9');

    expect(entries.map((entry) => entry.locale)).toEqual(['fr', 'en', 'de']);
  });

  it('ignores malformed entries', () => {
    expect(parseAcceptLanguage('en, ,fr;q=oops')).toEqual([{ locale: 'en', quality: 1 }]);
  });
});

describe('matchSupportedLocale', () => {
  const supported = ['en', 'fr', 'de_AT'];

  it('matches exact tags case-insensitively', () => {
    expect(matchSupportedLocale(parseAcceptLanguage('FR'), supported)).toBe('fr');
    expect(matchSupportedLocale(parseAcceptLanguage('de_at'), supported)).toBe('de_AT');
  });

  it('folds region variants onto the base locale', () => {
    expect(matchSupportedLocale(parseAcceptLanguage('en-GB,en;q=0.9'), supported)).toBe('en');
    expect(matchSupportedLocale(parseAcceptLanguage('fr-CA,fr;q=0.9'), supported)).toBe('fr');
  });

  it('returns null when nothing offered is supported', () => {
    expect(matchSupportedLocale(parseAcceptLanguage('ja,ko;q=0.9'), supported)).toBeNull();
  });

  it('skips wildcards', () => {
    expect(matchSupportedLocale(parseAcceptLanguage('*'), supported)).toBeNull();
    expect(matchSupportedLocale(parseAcceptLanguage('ja;q=0.9,*;q=0.8'), supported)).toBeNull();
  });
});

describe('SetLocale middleware', () => {
  function translator(locale = 'en'): Translator {
    return new Translator(new FileLoader([LANG]), locale, 'en');
  }

  it('switches to a supported locale from the header', async () => {
    const target = translator();
    const middleware = makeSetLocale(() => target);

    await middleware(makeRequest('fr-CA,fr;q=0.9,en;q=0.8'), response, async () => undefined);

    expect(target.getLocale()).toBe('fr');
  });

  it('keeps the current locale when nothing matches', async () => {
    const target = translator();
    const middleware = makeSetLocale(() => target);

    await middleware(makeRequest('ja,ko;q=0.9'), response, async () => undefined);

    expect(target.getLocale()).toBe('en');
  });

  it('keeps the current locale when the header is absent', async () => {
    const target = translator('fr');
    const middleware = makeSetLocale(() => target);

    await middleware(makeRequest(), response, async () => undefined);

    expect(target.getLocale()).toBe('fr');
  });

  it('waits for module-backed locales so translations are usable at once', async () => {
    const target = translator();
    const middleware = makeSetLocale(() => target);

    await middleware(makeRequest('de'), response, async () => undefined);

    expect(target.getLocale()).toBe('de');
    expect(target.get('validation.required')).toBe('Das Feld :attribute ist erforderlich.');
  });

  it('falls back to the container translator with no resolver', async () => {
    const target = translator();

    const app = new Application(join(process.cwd(), 'tests/Translation/fixtures'));

    app.instance('translator', target);

    await SetLocale(makeRequest('fr'), response, async () => undefined);

    expect(target.getLocale()).toBe('fr');
  });
});

describe('SetLocale through the HTTP kernel', () => {
  it('dispatches with the negotiated locale active', async () => {
    const app = new Application(join(process.cwd(), 'tests/Translation/fixtures'));

    app.register(TranslationServiceProvider);
    await app.boot();

    const translator = app.make<Translator>('translator');
    const router = new Router(app);

    app.singleton('router', () => router);

    const kernel = new Kernel(app);

    kernel.use(SetLocale);

    router.get('/locale', () => ({ locale: translator.getLocale() }));

    const response = await handle(kernel, 'GET', '/locale', { headers: { 'accept-language': 'fr,en;q=0.5' } });

    expect(JSON.parse(response.body).locale).toBe('fr');
  });
});
