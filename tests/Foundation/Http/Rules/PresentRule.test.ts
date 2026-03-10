import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('PresentRule', () => {
  it('fails when field missing', async () => {
    const v = new Validator({}, { token: [Rule.present()] });
    expect(await v.validate()).toBe(false);
  });
  it('passes when field is present', async () => {
    const v = new Validator({ token: null }, { token: [Rule.present()] });
    expect(await v.validate()).toBe(true);
  });
});
