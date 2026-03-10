import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('DimensionsRule', () => {
  it('passes when width/height match', async () => {
    const v = new Validator(
      { img: { mimetype: 'image/png', width: 100, height: 50 } },
      { img: [Rule.dimensions({ width: 100, height: 50 })] }
    );
    expect(await v.validate()).toBe(true);
  });
  it('fails when width does not match', async () => {
    const v = new Validator(
      { img: { mimetype: 'image/png', width: 90, height: 50 } },
      { img: [Rule.dimensions({ width: 100 })] }
    );
    expect(await v.validate()).toBe(false);
  });
});
