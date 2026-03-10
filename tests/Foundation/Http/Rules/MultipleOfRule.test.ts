import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('MultipleOfRule', () => {
  it('passes when value is multiple', async () => {
    const v = new Validator({ n: 10 }, { n: [Rule.multipleOf(5)] });
    expect(await v.validate()).toBe(true);
  });
  it('fails when not multiple', async () => {
    const v = new Validator({ n: 11 }, { n: [Rule.multipleOf(5)] });
    expect(await v.validate()).toBe(false);
  });
});
