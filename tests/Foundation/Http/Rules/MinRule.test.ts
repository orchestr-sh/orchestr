import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('MinRule', () => {
  it('fails when string shorter than min', async () => {
    const v = new Validator({ s: 'abc' }, { s: [Rule.min(5)] });
    expect(await v.validate()).toBe(false);
  });
  it('passes when string length >= min', async () => {
    const v = new Validator({ s: 'abcdef' }, { s: [Rule.min(5)] });
    expect(await v.validate()).toBe(true);
  });
});
