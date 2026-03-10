import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('DecimalRule', () => {
  it('passes for decimal with specific places', async () => {
    const v = new Validator({ n: '3.14' }, { n: [Rule.decimal(2)] });
    expect(await v.validate()).toBe(true);
  });
  it('fails when places mismatch', async () => {
    const v = new Validator({ n: '3.1' }, { n: [Rule.decimal(2)] });
    expect(await v.validate()).toBe(false);
  });
});
