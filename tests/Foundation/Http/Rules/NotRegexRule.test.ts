import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('NotRegexRule', () => {
  it('passes when value does not match pattern', async () => {
    const v = new Validator({ s: 'x' }, { s: [Rule.notRegex(/^a/)] });
    expect(await v.validate()).toBe(true);
  });
  it('fails when value matches', async () => {
    const v = new Validator({ s: 'abc' }, { s: [Rule.notRegex(/^a/)] });
    expect(await v.validate()).toBe(false);
  });
});
