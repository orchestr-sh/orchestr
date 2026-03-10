import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('JsonRule', () => {
  it('passes for valid JSON string', async () => {
    const v = new Validator({ j: '{"a":1}' }, { j: [Rule.json()] });
    expect(await v.validate()).toBe(true);
  });
  it('fails for invalid JSON', async () => {
    const v = new Validator({ j: '{a:}' }, { j: [Rule.json()] });
    expect(await v.validate()).toBe(false);
  });
});
