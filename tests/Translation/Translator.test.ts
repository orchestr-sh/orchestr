/**
 * Translator - key resolution, replacements, pluralization and fallback
 *
 * Covers the acceptance criteria around `__()`-style lookups: nested
 * keys (`messages.nested.deep.key`), `:name` interpolation, choice
 * forms selected by count, the locale fallback chain ending in the key
 * itself, and `package::file.key` namespaced lines.
 */

import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FileLoader } from '@/Translation/FileLoader';
import { parseTranslationKey, Translator } from '@/Translation/Translator';

const LANG = join(process.cwd(), 'tests/Translation/fixtures/lang');

function makeTranslator(locale: string = 'en', fallback: string = 'en'): Translator {
  return new Translator(new FileLoader([LANG]), locale, fallback);
}

describe('parseTranslationKey', () => {
  it('splits namespace, group and item', () => {
    expect(parseTranslationKey('package::file.nested.key')).toEqual({
      namespace: 'package',
      group: 'file',
      item: 'nested.key',
    });
  });

  it('defaults to the application namespace and flat group', () => {
    expect(parseTranslationKey('messages.welcome')).toEqual({ namespace: '*', group: 'messages', item: 'welcome' });
    expect(parseTranslationKey('welcome')).toEqual({ namespace: '*', group: '*', item: 'welcome' });
  });
});

describe('Translator', () => {
  describe('nested keys', () => {
    it('reads dot notation inside a language file', () => {
      const translator = makeTranslator();

      expect(translator.get('messages.nested.deep.key')).toBe('Deep value: :value');
    });

    it('reads top-level lines from the flat {locale}.json file', () => {
      const translator = makeTranslator();

      expect(translator.get('top_level')).toBe('Top level line');
    });

    it('has() reports known and unknown keys', () => {
      const translator = makeTranslator();

      expect(translator.has('messages.welcome')).toBe(true);
      expect(translator.has('messages.nope')).toBe(false);
      // Object containers (size-based rule variants) are not lines
      expect(translator.has('validation.min')).toBe(false);
      expect(translator.has('validation.min.string')).toBe(true);
    });
  });

  describe('replacements', () => {
    it('interpolates :name tokens', () => {
      const translator = makeTranslator();

      expect(translator.get('messages.greeting', { name: 'Sam' })).toBe('Hello, Sam!');
      expect(translator.get('messages.nested.deep.key', { value: 42 })).toBe('Deep value: 42');
    });

    it('never swallows longer placeholders (:cost vs :costs)', () => {
      const translator = makeTranslator();

      expect(translator.get('total is :cost, not :costs', { cost: 5, costs: 9 })).toBe('total is 5, not 9');
    });

    it('honors capitalized and upper-case placeholder variants', () => {
      const translator = makeTranslator();

      expect(translator.get('messages.upper', { name: 'sam' })).toBe('Hi Sam, SAM');
    });

    it('leaves unknown placeholders untouched', () => {
      const translator = makeTranslator();

      expect(translator.get('messages.greeting')).toBe('Hello, :name!');
    });
  });

  describe('fallback chain', () => {
    it('answers from the fallback locale when the active one misses', () => {
      const translator = makeTranslator('fr', 'en');

      expect(translator.get('partial.key')).toBe('valeur française');
      expect(translator.get('partial.second')).toBe('english second');
      expect(translator.get('messages.welcome')).toBe('Welcome!');
    });

    it('answers with the key itself when no locale has a line', () => {
      const translator = makeTranslator('fr', 'en');

      expect(translator.get('nothing.here')).toBe('nothing.here');
      expect(translator.get('nothing.here', { name: 'Sam' })).toBe('nothing.here');
    });

    it('supports explicit per-call locales', () => {
      const translator = makeTranslator();

      expect(translator.get('partial.key', {}, 'fr')).toBe('valeur française');
    });

    it('exposes locale and fallback accessors', () => {
      const translator = makeTranslator();

      expect(translator.getLocale()).toBe('en');
      translator.setLocale('fr');
      expect(translator.getLocale()).toBe('fr');
      expect(translator.getFallback()).toBe('en');
      translator.setFallback('de');
      expect(translator.getFallback()).toBe('de');
    });

    it('lists the locales the loader knows plus current and fallback', () => {
      const translator = makeTranslator('fr', 'en');

      expect(translator.locales()).toEqual(expect.arrayContaining(['de', 'en', 'es', 'fr']));
    });
  });

  describe('namespaced keys', () => {
    it('resolves package::file.key through registered hints', () => {
      const translator = makeTranslator();

      translator.addNamespace('shop', join(process.cwd(), 'tests/Translation/fixtures/vendor/shop'));

      expect(translator.get('shop::products.offer', { price: '$5' })).toBe('Only $5!');
      expect(translator.has('shop::products.offer')).toBe(true);
      expect(translator.has('shop::products.missing')).toBe(false);
    });

    it('answers with the key when the namespace is unknown', () => {
      const translator = makeTranslator();

      expect(translator.get('shop::products.offer')).toBe('shop::products.offer');
    });
  });

  describe('module (nested object) lines', () => {
    it('adopts asynchronously imported modules after preload', async () => {
      const translator = makeTranslator();

      await translator.preload('es');
      translator.setLocale('es');

      expect(translator.get('partial.key')).toBe('spanish value');
      expect(translator.choice('partial.plural', 2)).toBe('2 manzanas');
    });

    it('falls back to the fallback locale while a module import settles', async () => {
      const translator = makeTranslator('es', 'en');

      // Not preloaded: the async lines are not there yet, the chain answers
      expect(translator.get('partial.key')).toBe('english value');
    });
  });

  describe('programmatic lines', () => {
    it('addLines merges over file lines and deep-merges nested keys', () => {
      const translator = makeTranslator();

      translator.addLines({ greeting: 'Howdy :name', nested: { added: 'x' } }, 'messages');

      expect(translator.get('messages.greeting', { name: 'Bo' })).toBe('Howdy Bo');
      expect(translator.get('messages.nested.added')).toBe('x');
      expect(translator.get('messages.nested.deep.key')).toBe('Deep value: :value');
    });
  });

  describe('trans / transChoice aliases', () => {
    it('mirrors get and choice', () => {
      const translator = makeTranslator();

      expect(translator.trans('messages.welcome')).toBe('Welcome!');
      expect(translator.transChoice('messages.apples', 2)).toBe('There are 2 apples');
    });
  });

  describe('choice forms', () => {
    it('selects singular and plural ordinal forms', () => {
      const translator = makeTranslator();

      expect(translator.choice('messages.apples', 1)).toBe('There is one apple');
      expect(translator.choice('messages.apples', 0)).toBe('There are 0 apples');
      expect(translator.choice('messages.inbox', 1)).toBe('You have one message');
      expect(translator.choice('messages.inbox', 5)).toBe('You have 5 messages');
    });

    it('honors {n} exact and [min,max] range specs', () => {
      const translator = makeTranslator();

      expect(translator.choice('messages.counted', 0)).toBe('None');
      expect(translator.choice('messages.counted', 1)).toBe('A few');
      expect(translator.choice('messages.counted', 19)).toBe('A few');
      expect(translator.choice('messages.counted', 20)).toBe('Many');
      expect(translator.choice('messages.counted', 5000)).toBe('Many');
    });
  });
});
