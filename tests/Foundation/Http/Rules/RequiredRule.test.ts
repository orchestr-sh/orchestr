import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('RequiredRule', () => {
  it('fails when value missing', async () => {
    const v = new Validator({}, { name: [Rule.required()] });
    expect(await v.validate()).toBe(false);
  });
  it('passes when value present', async () => {
    const v = new Validator({ name: 'ok' }, { name: [Rule.required()] });
    expect(await v.validate()).toBe(true);
  });
});
