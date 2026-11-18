/**
 * FileLoader - JSON and nested object/TS module loading
 */

import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FileLoader } from '@/Translation/FileLoader';

const FIXTURES = join(process.cwd(), 'tests/Translation/fixtures');
const LANG = join(FIXTURES, 'lang');

describe('FileLoader', () => {
  it('reads JSON language files synchronously', () => {
    const loader = new FileLoader([LANG]);

    expect(loader.load('en', '*', 'partial')).toEqual({ key: 'english value', second: 'english second' });
  });

  it('imports nested object/TS modules asynchronously', async () => {
    const loader = new FileLoader([LANG]);
    const loaded = loader.load('es', '*', 'partial');

    expect(loaded).toBeInstanceOf(Promise);
    await expect(loaded).resolves.toEqual({ key: 'spanish value', plural: 'una manzana|:count manzanas' });
  });

  it('memoizes module imports so repeat lookups share one import', async () => {
    const loader = new FileLoader([LANG]);

    const first = loader.load('es', '*', 'partial') as Promise<Record<string, any>>;
    const second = loader.load('es', '*', 'partial') as Promise<Record<string, any>>;

    expect(first).toBe(second);
  });

  it('answers null for unknown locales and groups', () => {
    const loader = new FileLoader([LANG]);

    expect(loader.load('xx', '*', 'nothing')).toBeNull();
    expect(loader.load('en', '*', 'nothing')).toBeNull();
  });

  it('reads flat {locale}.json files for the * group', () => {
    const loader = new FileLoader([LANG]);

    expect(loader.load('en', '*', '*')).toEqual({ top_level: 'Top level line', flat_name: 'Hello :name' });
  });

  it('loads package lines from registered namespace hints', () => {
    const loader = new FileLoader([LANG]);

    loader.addNamespace('shop', join(FIXTURES, 'vendor/shop'));

    expect(loader.load('en', 'shop', 'products')).toEqual({ offer: 'Only :price!' });
    // Application paths are not consulted for namespaced lookups
    expect(loader.load('en', 'shop', 'partial')).toBeNull();
  });

  it('reports the available locales across its roots', () => {
    const loader = new FileLoader([LANG]);

    expect(loader.locales()).toEqual(['de', 'en', 'es', 'fr']);
  });

  it('lists the groups of a locale including the flat json star group', () => {
    const loader = new FileLoader([LANG]);

    expect(loader.groups('en').sort()).toEqual(
      expect.arrayContaining(['*', 'attributes', 'messages', 'partial', 'validation'])
    );
    expect(loader.groups('de')).toEqual(['validation']);
  });
});
