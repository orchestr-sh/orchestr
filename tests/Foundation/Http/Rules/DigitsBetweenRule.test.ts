import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('DigitsBetweenRule', () => {
  it('passes when digits within range', async () => {
    const v = new Validator({ n: '1234' }, { n: [Rule.digitsBetween(3, 5)] });
    expect(await v.validate()).toBe(true);
  });
  it('fails when digits below min', async () => {
    const v = new Validator({ n: '12' }, { n: [Rule.digitsBetween(3, 5)] });
    expect(await v.validate()).toBe(false);
  });
});
