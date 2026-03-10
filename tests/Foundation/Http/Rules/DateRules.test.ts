import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('Date Rules', () => {
  it('date passes for valid ISO date', async () => {
    const v = new Validator({ d: '2020-01-01' }, { d: [Rule.date()] });
    expect(await v.validate()).toBe(true);
  });
  it('date fails for invalid', async () => {
    const v = new Validator({ d: 'not-date' }, { d: [Rule.date()] });
    expect(await v.validate()).toBe(false);
  });
  it('date_equals passes for equal date', async () => {
    const v = new Validator({ d: '2020-01-01' }, { d: [Rule.dateEquals('2020-01-01')] });
    expect(await v.validate()).toBe(true);
  });
  it('after/before comparisons', async () => {
    const v1 = new Validator({ d: '2020-01-02' }, { d: [Rule.after('2020-01-01')] });
    expect(await v1.validate()).toBe(true);
    const v2 = new Validator({ d: '2020-01-02' }, { d: [Rule.afterOrEqual('2020-01-02')] });
    expect(await v2.validate()).toBe(true);
    const v3 = new Validator({ d: '2020-01-02' }, { d: [Rule.before('2020-01-03')] });
    expect(await v3.validate()).toBe(true);
    const v4 = new Validator({ d: '2020-01-02' }, { d: [Rule.beforeOrEqual('2020-01-02')] });
    expect(await v4.validate()).toBe(true);
  });
});
