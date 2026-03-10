import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('ExcludeRules', () => {
  it('exclude_if excludes when condition met', async () => {
    const v = new Validator({ type: 'card', cc: '' }, { cc: [Rule.excludeIf('type', 'card'), Rule.required()] });
    expect(await v.validate()).toBe(true);
  });
  it('exclude_unless excludes when condition not met', async () => {
    const v = new Validator({ type: 'card', cc: '' }, { cc: [Rule.excludeUnless('type', 'cash'), Rule.required()] });
    expect(await v.validate()).toBe(true);
  });
  it('exclude can be used to bypass subsequent rules', async () => {
    const v = new Validator({ cc: '' }, { cc: [Rule.exclude(), Rule.required()] });
    expect(await v.validate()).toBe(true);
  });
});
