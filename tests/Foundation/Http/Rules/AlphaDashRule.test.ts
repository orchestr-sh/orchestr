import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('AlphaDashRule', () => {
  it('passes for letters, numbers, dash and underscore', async () => {
    const v = new Validator({ s: 'a-1_b' }, { s: [Rule.alphaDash()] });
    expect(await v.validate()).toBe(true);
  });
  it('fails for other punctuation', async () => {
    const v = new Validator({ s: 'a!' }, { s: [Rule.alphaDash()] });
    expect(await v.validate()).toBe(false);
  });
});
