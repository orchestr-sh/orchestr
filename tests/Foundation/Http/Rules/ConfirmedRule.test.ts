import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('ConfirmedRule', () => {
  it('fails when confirmation mismatches', async () => {
    const v = new Validator({ password: 'a', password_confirmation: 'b' }, { password: [Rule.confirmed()] });
    expect(await v.validate()).toBe(false);
  });
  it('passes when confirmation matches', async () => {
    const v = new Validator({ password: 'a', password_confirmation: 'a' }, { password: [Rule.confirmed()] });
    expect(await v.validate()).toBe(true);
  });
});
