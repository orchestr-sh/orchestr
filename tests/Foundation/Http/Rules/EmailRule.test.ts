import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('EmailRule', () => {
  it('passes for basic email', async () => {
    const v = new Validator({ e: 'a@b.com' }, { e: [Rule.email()] });
    expect(await v.validate()).toBe(true);
  });
  it('fails for invalid email', async () => {
    const v = new Validator({ e: 'not-email' }, { e: [Rule.email()] });
    expect(await v.validate()).toBe(false);
  });
});
