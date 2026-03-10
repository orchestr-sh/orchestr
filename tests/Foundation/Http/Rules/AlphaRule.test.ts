import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('AlphaRule', () => {
  it('passes for letters only', async () => {
    const v = new Validator({ s: 'abc' }, { s: [Rule.alpha()] });
    expect(await v.validate()).toBe(true);
  });
  it('fails for numbers', async () => {
    const v = new Validator({ s: 'a1' }, { s: [Rule.alpha()] });
    expect(await v.validate()).toBe(false);
  });
});
