import { describe, it, expect } from 'vitest';
import { Validator, type ValidationRules } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

describe('Validator', () => {
  it('validates using string rules', async () => {
    const data = { name: 'Mike', email: 'mike@example.com', age: 30 };
    const rules: ValidationRules = {
      name: 'required|string|min:3',
      email: 'required|email',
      age: 'required|integer|min:18',
    };
    const validator = new Validator(data, rules);
    const result = await validator.validate();
    expect(result).toBe(true);
    expect(validator.passes()).toBe(true);
    expect(validator.errors()).toEqual({});
    expect(validator.validated()).toEqual(data);
  });

  it('validates using Rule builder objects', async () => {
    const data = { name: 'Alice', email: 'alice@example.com', age: 25 };
    const rules: ValidationRules = {
      name: [Rule.required(), Rule.string(), Rule.min(3)],
      email: [Rule.required(), Rule.email()],
      age: [Rule.required(), Rule.integer(), Rule.min(18)],
    };
    const validator = new Validator(data, rules);
    const result = await validator.validate();
    expect(result).toBe(true);
    expect(validator.errors()).toEqual({});
  });

  it('nullable allows null values for other rules', async () => {
    const data = { bio: null };
    const rules: ValidationRules = {
      bio: [Rule.string(), Rule.nullable()],
    };
    const validator = new Validator(data, rules);
    const result = await validator.validate();
    expect(result).toBe(true);
    expect(validator.errors()).toEqual({});
    expect(validator.validated()).toEqual({ bio: null });
  });

  it('sometimes skips validation when field is missing', async () => {
    const data = {};
    const rules: ValidationRules = {
      nickname: [Rule.sometimes(), Rule.string(), Rule.min(3)],
    };
    const validator = new Validator(data, rules);
    const result = await validator.validate();
    expect(result).toBe(true);
    expect(validator.errors()).toEqual({});
    expect(validator.validated()).toEqual({});
  });

  it('size validation works for strings and numbers', async () => {
    const data1 = { code: 'ABC' };
    const rules1: ValidationRules = { code: [Rule.size(3)] };
    const v1 = new Validator(data1, rules1);
    expect(await v1.validate()).toBe(true);

    const data2 = { code: 'AB' };
    const v2 = new Validator(data2, rules1);
    expect(await v2.validate()).toBe(false);
    expect(v2.errors().code?.length).toBeGreaterThan(0);

    const data3 = { qty: 5 };
    const rules3: ValidationRules = { qty: [Rule.size(5)] };
    const v3 = new Validator(data3, rules3);
    expect(await v3.validate()).toBe(true);
  });
});
