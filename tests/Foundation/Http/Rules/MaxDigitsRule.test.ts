import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('MaxDigitsRule', () => {
  it('passes when digits <= max', async () => {
    const v = new Validator({ n: '12' }, { n: [Rule.maxDigits(2)] });
    expect(await v.validate()).toBe(true);
  });
  it('fails when digits > max', async () => {
    const v = new Validator({ n: '123' }, { n: [Rule.maxDigits(2)] });
    expect(await v.validate()).toBe(false);
  });
});
