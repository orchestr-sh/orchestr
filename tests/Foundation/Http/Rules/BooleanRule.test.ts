import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('BooleanRule', () => {
  it('passes for allowed boolean-like values', async () => {
    const v = new Validator({ ok: 'true' }, { ok: [Rule.boolean()] });
    expect(await v.validate()).toBe(true);
  });
  it('fails for disallowed values', async () => {
    const v = new Validator({ ok: 'yesno' }, { ok: [Rule.boolean()] });
    expect(await v.validate()).toBe(false);
  });
});
