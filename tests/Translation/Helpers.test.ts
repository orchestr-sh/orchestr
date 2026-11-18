/**
 * Localization helpers and the Lang facade
 *
 * `__('messages.welcome')`, `__('messages.greeting', { name: 'Sam' })`
 * and `trans_choice('messages.apples', 2)` - the acceptance criteria
 * spelled the way application code calls them, plus the facade over the
 * same container translator.
 */

import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { Lang } from '@/Facades/Lang';
import { Application } from '@/Foundation/Application';
import { Facade } from '@/Support/Facade';
import { __, lang_path, trans, trans_choice } from '@/Support/helpers';
import { TranslationServiceProvider } from '@/Translation/TranslationServiceProvider';
import { Translator } from '@/Translation/Translator';

const FIXTURES = join(process.cwd(), 'tests/Translation/fixtures');

async function bootedApp(): Promise<Application> {
  const app = new Application(FIXTURES);

  app.register(TranslationServiceProvider);
  await app.boot();
  Facade.setFacadeApplication(app);

  return app;
}

describe('translation helpers', () => {
  it('__() returns the translated string', async () => {
    await bootedApp();

    expect(__('messages.welcome')).toBe('Welcome!');
    expect(trans('messages.welcome')).toBe('Welcome!');
  });

  it('__() interpolates replacements', async () => {
    await bootedApp();

    expect(__('messages.greeting', { name: 'Sam' })).toBe('Hello, Sam!');
    expect(trans('messages.greeting', { name: 'Sam' })).toBe('Hello, Sam!');
  });

  it('trans_choice() selects the plural form', async () => {
    await bootedApp();

    expect(trans_choice('messages.apples', 1)).toBe('There is one apple');
    expect(trans_choice('messages.apples', 2)).toBe('There are 2 apples');
  });

  it('missing keys fall back to the fallback locale, then to the key', async () => {
    const app = await bootedApp();

    app.make<Translator>('translator').setLocale('fr');

    expect(__('partial.key')).toBe('valeur française');
    expect(__('partial.second')).toBe('english second');
    expect(__('definitely.missing')).toBe('definitely.missing');
  });

  it('lang_path() resolves against the application base path', async () => {
    const app = await bootedApp();

    expect(lang_path('en/validation.ts')).toBe(`${app.langPath('en/validation.ts')}`);
    expect(app.langPath()).toBe(`${FIXTURES}/lang`);
  });
});

describe('Lang facade', () => {
  it('proxies to the container translator', async () => {
    await bootedApp();

    expect(Lang.get('messages.welcome')).toBe('Welcome!');
    expect(Lang.get('messages.greeting', { name: 'Ada' })).toBe('Hello, Ada!');
    expect(Lang.choice('messages.apples', 2)).toBe('There are 2 apples');
    expect(Lang.has('messages.welcome')).toBe(true);
    expect(Lang.has('messages.nope')).toBe(false);

    expect(Lang.getLocale()).toBe('en');
    Lang.setLocale('fr');
    expect(Lang.getLocale()).toBe('fr');
    expect(Lang.getFallback()).toBe('en');
    Lang.setFallback('fr');
    expect(Lang.getFallback()).toBe('fr');
  });

  it('answers with the key without an application-bound translator', async () => {
    // Point the facades at an app that never registered the provider
    const bare = new Application(FIXTURES);

    Facade.setFacadeApplication(bare);

    expect(Lang.get('messages.welcome')).toBe('messages.welcome');
  });
});
