import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('NumericRule', () => {
  it('passes for numeric values', async () => {
    const v = new Validator({ n: 123 }, { n: [Rule.numeric()] });
    expect(await v.validate()).toBe(true);
  });
  it('fails for non-numeric', async () => {
    const v = new Validator({ n: 'abc' }, { n: [Rule.numeric()] });
    expect(await v.validate()).toBe(false);
  });
});
