import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('MinDigitsRule', () => {
  it('passes when digits >= min', async () => {
    const v = new Validator({ n: '123' }, { n: [Rule.minDigits(2)] });
    expect(await v.validate()).toBe(true);
  });
  it('fails when digits < min', async () => {
    const v = new Validator({ n: '1' }, { n: [Rule.minDigits(2)] });
    expect(await v.validate()).toBe(false);
  });
});
