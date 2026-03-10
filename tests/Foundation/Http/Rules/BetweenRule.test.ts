import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('BetweenRule', () => {
  it('passes when string length within range', async () => {
    const v = new Validator({ s: 'abcd' }, { s: [Rule.between(3, 5)] });
    expect(await v.validate()).toBe(true);
  });
  it('fails when outside range', async () => {
    const v = new Validator({ s: 'ab' }, { s: [Rule.between(3, 5)] });
    expect(await v.validate()).toBe(false);
  });
});
