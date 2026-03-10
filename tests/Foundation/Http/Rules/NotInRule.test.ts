import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('NotInRule', () => {
  it('fails for value in not_in list', async () => {
    const v = new Validator({ status: 'banned' }, { status: [Rule.notIn(['banned', 'deleted'])] });
    await v.validate();
    expect(v.fails()).toBe(true);
  });
  it('passes for value not in list', async () => {
    const v = new Validator({ status: 'active' }, { status: [Rule.notIn(['banned', 'deleted'])] });
    expect(await v.validate()).toBe(true);
  });
});
