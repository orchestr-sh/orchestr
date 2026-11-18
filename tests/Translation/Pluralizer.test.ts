/**
 * Pluralizer - choice-line form selection
 */

import { describe, expect, it } from 'vitest';
import { Pluralizer } from '@/Translation/Pluralizer';

const pluralizer = new Pluralizer();

describe('Pluralizer', () => {
  it('returns plain lines unchanged', () => {
    expect(pluralizer.choose('No forms here', 7)).toBe('No forms here');
  });

  it('selects the two English forms by count', () => {
    expect(pluralizer.choose('one apple|:count apples', 1)).toBe('one apple');
    expect(pluralizer.choose('one apple|:count apples', 2)).toBe(':count apples');
    expect(pluralizer.choose('one apple|:count apples', 0)).toBe(':count apples');
  });

  it('matches {n} exact specs', () => {
    expect(pluralizer.choose('{0} You have no messages|One message|Many messages', 0)).toBe('You have no messages');
    expect(pluralizer.choose('{0} None|{1} One|[2,*] Several', 1)).toBe('One');
  });

  it('matches [min,max] ranges with * open bounds', () => {
    const line = '{0} None|[1,19] A few|[20,*] Many';

    expect(pluralizer.choose(line, 0)).toBe('None');
    expect(pluralizer.choose(line, 1)).toBe('A few');
    expect(pluralizer.choose(line, 19)).toBe('A few');
    expect(pluralizer.choose(line, 20)).toBe('Many');
    expect(pluralizer.choose(line, 10_000)).toBe('Many');
  });

  it('falls back to the unqualified form when no spec matches', () => {
    expect(pluralizer.choose('{0} None|Some', 42)).toBe('Some');
    expect(pluralizer.choose('{1} Exactly one', 42)).toBe('Exactly one');
  });

  it('trims segments around the pipes', () => {
    expect(pluralizer.choose(' one | many ', 3)).toBe('many');
  });

  it('uses locale-aware rules', () => {
    // French treats 0 as singular; English does not
    expect(pluralizer.choose('une pomme|des pommes', 0, 'fr')).toBe('une pomme');
    expect(pluralizer.choose('one apple|many apples', 0, 'en')).toBe('many apples');
    expect(pluralizer.choose('one apple|many apples', 2, 'en')).toBe('many apples');
  });

  it('maps richer category systems onto indexed forms', () => {
    // Russian: one|few|many|other
    expect(pluralizer.choose('odin|malo|mnogo|drugoe', 1, 'ru')).toBe('odin');
    expect(pluralizer.choose('odin|malo|mnogo|drugoe', 3, 'ru')).toBe('malo');
    expect(pluralizer.choose('odin|malo|mnogo|drugoe', 12, 'ru')).toBe('mnogo');
    expect(pluralizer.choose('odin|malo|mnogo|drugoe', 1.5, 'ru')).toBe('drugoe');
  });

  it('survives unknown locales with the English rule', () => {
    expect(pluralizer.choose('one|many', 1, 'not-a-locale')).toBe('one');
    expect(pluralizer.choose('one|many', 5, 'not-a-locale')).toBe('many');
  });
});
