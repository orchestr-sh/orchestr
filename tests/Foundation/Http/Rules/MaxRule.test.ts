import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('MaxRule', () => {
  it('passes when string length <= max', async () => {
    const v = new Validator({ s: 'abc' }, { s: [Rule.max(5)] });
    expect(await v.validate()).toBe(true);
  });
  it('fails when string longer than max', async () => {
    const v = new Validator({ s: 'abcdef' }, { s: [Rule.max(5)] });
    expect(await v.validate()).toBe(false);
  });
});
