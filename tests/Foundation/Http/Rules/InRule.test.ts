import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('InRule', () => {
  it('passes for value in list', async () => {
    const v = new Validator({ status: 'active' }, { status: [Rule.in(['active', 'inactive'])] });
    expect(await v.validate()).toBe(true);
  });
  it('fails for value not in list', async () => {
    const v = new Validator({ status: 'archived' }, { status: [Rule.in(['active', 'inactive'])] });
    expect(await v.validate()).toBe(false);
  });
});
