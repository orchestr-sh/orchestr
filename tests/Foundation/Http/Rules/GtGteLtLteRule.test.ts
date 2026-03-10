import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('Comparison Rules', () => {
  it('gt compares field values', async () => {
    const v = new Validator({ min: 5, max: 10 }, { max: [Rule.gt('min')] });
    expect(await v.validate()).toBe(true);
  });
  it('gte compares field values', async () => {
    const v = new Validator({ min: 5, max: 5 }, { max: [Rule.gte('min')] });
    expect(await v.validate()).toBe(true);
  });
  it('lt compares field values', async () => {
    const v = new Validator({ a: 3, b: 2 }, { b: [Rule.lt('a')] });
    expect(await v.validate()).toBe(true);
  });
  it('lte compares field values', async () => {
    const v = new Validator({ a: 3, b: 3 }, { b: [Rule.lte('a')] });
    expect(await v.validate()).toBe(true);
  });
});
