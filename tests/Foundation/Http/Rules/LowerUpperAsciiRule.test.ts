import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('Lowercase/Uppercase/Ascii', () => {
  it('lowercase passes for lowercase string', async () => {
    const v = new Validator({ s: 'abc' }, { s: [Rule.lowercase()] });
    expect(await v.validate()).toBe(true);
  });
  it('uppercase passes for uppercase string', async () => {
    const v = new Validator({ s: 'ABC' }, { s: [Rule.uppercase()] });
    expect(await v.validate()).toBe(true);
  });
  it('ascii fails for non-ascii chars', async () => {
    const v = new Validator({ s: 'é' }, { s: [Rule.ascii()] });
    expect(await v.validate()).toBe(false);
  });
});
