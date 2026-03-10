import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('Starts/EndsWithRule', () => {
  it('starts_with passes', async () => {
    const v = new Validator({ slug: 'user_admin' }, { slug: [Rule.startsWith(['user'])] });
    expect(await v.validate()).toBe(true);
  });
  it('ends_with passes', async () => {
    const v = new Validator({ slug: 'user_admin' }, { slug: [Rule.endsWith(['admin'])] });
    expect(await v.validate()).toBe(true);
  });
  it('fails when conditions not met', async () => {
    const v = new Validator({ slug: 'user_admin' }, { slug: [Rule.startsWith(['admin']), Rule.endsWith(['user'])] });
    expect(await v.validate()).toBe(false);
  });
});
