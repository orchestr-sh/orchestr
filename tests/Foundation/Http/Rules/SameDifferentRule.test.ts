import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('Same/DifferentRule', () => {
  it('same passes when fields match', async () => {
    const v = new Validator({ a: 'x', b: 'x' }, { b: [Rule.same('a')] });
    expect(await v.validate()).toBe(true);
  });
  it('different passes when fields differ', async () => {
    const v = new Validator({ a: 'x', b: 'y' }, { b: [Rule.different('a')] });
    expect(await v.validate()).toBe(true);
  });
  it('same fails when fields differ', async () => {
    const v = new Validator({ a: 'x', b: 'y' }, { b: [Rule.same('a')] });
    expect(await v.validate()).toBe(false);
  });
});
