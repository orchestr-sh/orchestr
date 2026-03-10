import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('FilledRule', () => {
  it('fails when field present but empty', async () => {
    const v = new Validator({ name: '' }, { name: [Rule.filled()] });
    expect(await v.validate()).toBe(false);
  });
  it('passes when field not present', async () => {
    const v = new Validator({}, { name: [Rule.filled()] });
    expect(await v.validate()).toBe(true);
  });
  it('passes when field has value', async () => {
    const v = new Validator({ name: 'x' }, { name: [Rule.filled()] });
    expect(await v.validate()).toBe(true);
  });
});
