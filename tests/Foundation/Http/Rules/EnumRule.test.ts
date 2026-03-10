import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('EnumRule', () => {
  it('passes when value is allowed', async () => {
    const v = new Validator({ status: 'open' }, { status: [Rule.enum(['open', 'closed'])] });
    expect(await v.validate()).toBe(true);
  });
  it('fails when value not allowed', async () => {
    const v = new Validator({ status: 'pending' }, { status: [Rule.enum(['open', 'closed'])] });
    expect(await v.validate()).toBe(false);
  });
});
