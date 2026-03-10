import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('ImageFileRule', () => {
  it('passes for image mimetype', async () => {
    const v = new Validator({ avatar: { mimetype: 'image/png' } }, { avatar: [Rule.imageFile()] });
    expect(await v.validate()).toBe(true);
  });
  it('fails for non-image mimetype', async () => {
    const v = new Validator({ avatar: { mimetype: 'application/pdf' } }, { avatar: [Rule.imageFile()] });
    expect(await v.validate()).toBe(false);
  });
});
