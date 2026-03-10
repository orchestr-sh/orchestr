import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('IntegerRule', () => {
  it('passes for integers', async () => {
    const v = new Validator({ n: 5 }, { n: [Rule.integer()] });
    expect(await v.validate()).toBe(true);
  });
  it('fails for decimals', async () => {
    const v = new Validator({ n: 5.5 }, { n: [Rule.integer()] });
    expect(await v.validate()).toBe(false);
  });
});
