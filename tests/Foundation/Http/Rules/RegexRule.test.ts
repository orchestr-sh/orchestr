import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('RegexRule', () => {
  it('passes when value matches pattern', async () => {
    const v = new Validator({ s: 'abc' }, { s: [Rule.regex(/^a/)] });
    expect(await v.validate()).toBe(true);
  });
  it('fails when value does not match', async () => {
    const v = new Validator({ s: 'x' }, { s: [Rule.regex(/^a/)] });
    expect(await v.validate()).toBe(false);
  });
});
