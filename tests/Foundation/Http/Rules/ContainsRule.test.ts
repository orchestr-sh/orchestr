import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('ContainsRule', () => {
  it('passes when substring present', async () => {
    const v = new Validator({ s: 'hello world' }, { s: [Rule.contains('world')] });
    expect(await v.validate()).toBe(true);
  });
  it('fails when substring missing', async () => {
    const v = new Validator({ s: 'hello' }, { s: [Rule.contains('world')] });
    expect(await v.validate()).toBe(false);
  });
});
