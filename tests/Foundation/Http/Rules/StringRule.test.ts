import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('StringRule', () => {
  it('passes for string', async () => {
    const v = new Validator({ s: 'a' }, { s: [Rule.string()] });
    expect(await v.validate()).toBe(true);
  });
  it('fails for non-string', async () => {
    const v = new Validator({ s: 1 }, { s: [Rule.string()] });
    expect(await v.validate()).toBe(false);
  });
});
