import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('NullableRule', () => {
  it('passes when value is null', async () => {
    const v = new Validator({ name: null }, { name: [Rule.nullable()] });
    expect(await v.validate()).toBe(true);
  });
  it('works with required to still fail', async () => {
    const v = new Validator({ name: null }, { name: [Rule.nullable(), Rule.required()] });
    expect(await v.validate()).toBe(false);
  });
});
