import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('SometimesRule', () => {
  it('skips validation when field missing', async () => {
    const v = new Validator({}, { note: [Rule.sometimes(), Rule.string()] });
    expect(await v.validate()).toBe(true);
  });
  it('validates when field present', async () => {
    const v = new Validator({ note: 123 }, { note: [Rule.sometimes(), Rule.string()] });
    expect(await v.validate()).toBe(false);
  });
});
