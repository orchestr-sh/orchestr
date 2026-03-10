import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('AlphaNumRule', () => {
  it('passes for letters and numbers', async () => {
    const v = new Validator({ s: 'a1' }, { s: [Rule.alphaNum()] });
    expect(await v.validate()).toBe(true);
  });
  it('fails for punctuation', async () => {
    const v = new Validator({ s: 'a!' }, { s: [Rule.alphaNum()] });
    expect(await v.validate()).toBe(false);
  });
});
