import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('DigitsRule', () => {
  it('passes when value has exact digits', async () => {
    const v = new Validator({ n: '123' }, { n: [Rule.digits(3)] });
    expect(await v.validate()).toBe(true);
  });
  it('fails when digits mismatch', async () => {
    const v = new Validator({ n: '12' }, { n: [Rule.digits(3)] });
    expect(await v.validate()).toBe(false);
  });
});
