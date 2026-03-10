import { describe, it, expect } from 'vitest';
import { Validator, type ValidationRules } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('Laravel rule coverage', () => {
  it('required_if enforces presence based on other field', async () => {
    const data = { type: 'card' };
    const rules: ValidationRules = {
      type: [Rule.required()],
      cc: [Rule.requiredIf('type', 'card')],
    };
    const v = new Validator(data, rules);
    const ok = await v.validate();
    expect(ok).toBe(false);
    expect(v.errors().cc?.length).toBeGreaterThan(0);
  });

  it('starts_with and ends_with validate strings', async () => {
    const data = { slug: 'user_admin' };
    const rules: ValidationRules = { slug: [Rule.startsWith(['user']), Rule.endsWith(['admin'])] };
    const v = new Validator(data, rules);
    expect(await v.validate()).toBe(true);
  });

  it('accepted validates truthy acceptance values', async () => {
    const data = { terms: 'yes' };
    const rules: ValidationRules = { terms: [Rule.accepted()] };
    const v = new Validator(data, rules);
    expect(await v.validate()).toBe(true);
  });

  it('gt compares numeric fields', async () => {
    const data = { min: 5, max: 10 };
    const rules: ValidationRules = { max: [Rule.gt('min')] };
    const v = new Validator(data, rules);
    expect(await v.validate()).toBe(true);
  });

  it('distinct rejects duplicates', async () => {
    const data = { tags: ['a', 'a'] };
    const rules: ValidationRules = { tags: [Rule.array(), Rule.distinct()] };
    const v = new Validator(data, rules);
    expect(await v.validate()).toBe(false);
  });
});
