import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('ArrayRule', () => {
  it('passes for arrays', async () => {
    const v = new Validator({ tags: ['a'] }, { tags: [Rule.array()] });
    expect(await v.validate()).toBe(true);
  });
  it('fails for non-arrays', async () => {
    const v = new Validator({ tags: 'a' }, { tags: [Rule.array()] });
    expect(await v.validate()).toBe(false);
  });
});
