import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('InArrayRule', () => {
  it('passes when value exists in other field array', async () => {
    const v = new Validator({ choices: ['a', 'b'], pick: 'a' }, { pick: [Rule.inArray('choices')] });
    expect(await v.validate()).toBe(true);
  });
  it('fails when value not in array', async () => {
    const v = new Validator({ choices: ['a', 'b'], pick: 'c' }, { pick: [Rule.inArray('choices')] });
    expect(await v.validate()).toBe(false);
  });
});
