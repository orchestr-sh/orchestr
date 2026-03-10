import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('SizeRule', () => {
  it('passes when string length equals size', async () => {
    const v = new Validator({ s: 'abc' }, { s: [Rule.size(3)] });
    expect(await v.validate()).toBe(true);
  });
  it('fails when length differs', async () => {
    const v = new Validator({ s: 'ab' }, { s: [Rule.size(3)] });
    expect(await v.validate()).toBe(false);
  });
});
