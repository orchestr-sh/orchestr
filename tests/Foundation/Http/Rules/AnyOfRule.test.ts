import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('AnyOfRule', () => {
  it('passes if any inner rule passes', async () => {
    const v = new Validator({ s: 'abc' }, { s: [Rule.anyOf([Rule.string(), Rule.numeric()])] });
    expect(await v.validate()).toBe(true);
  });
  it('fails if none pass', async () => {
    const v = new Validator({ s: true }, { s: [Rule.anyOf([Rule.string(), Rule.digits(3)])] });
    expect(await v.validate()).toBe(false);
  });
});
