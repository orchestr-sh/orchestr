import { describe, it, expect } from 'vitest';
import { Validator } from '@/Foundation/Http/Validator';

describe('Validator', () => {
  describe('required', () => {
    it('fails for undefined value', async () => {
      const v = new Validator({}, { name: 'required' });
      await v.validate();
      expect(v.fails()).toBe(true);
      expect(v.errors()['name']).toBeDefined();
    });

    it('fails for null value', async () => {
      const v = new Validator({ name: null }, { name: 'required' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });

    it('fails for empty string', async () => {
      const v = new Validator({ name: '' }, { name: 'required' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });

    it('passes for non-empty value', async () => {
      const v = new Validator({ name: 'John' }, { name: 'required' });
      const result = await v.validate();
      expect(result).toBe(true);
      expect(v.passes()).toBe(true);
    });
  });

  describe('email', () => {
    it('passes for valid email', async () => {
      const v = new Validator({ email: 'user@example.com' }, { email: 'email' });
      expect(await v.validate()).toBe(true);
    });

    it('fails for invalid email', async () => {
      const v = new Validator({ email: 'not-an-email' }, { email: 'email' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });

    it('passes for undefined (not required)', async () => {
      const v = new Validator({}, { email: 'email' });
      expect(await v.validate()).toBe(true);
    });
  });

  describe('string', () => {
    it('passes for string values', async () => {
      const v = new Validator({ name: 'hello' }, { name: 'string' });
      expect(await v.validate()).toBe(true);
    });

    it('fails for non-string values', async () => {
      const v = new Validator({ name: 123 }, { name: 'string' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });
  });

  describe('numeric', () => {
    it('passes for numbers', async () => {
      const v = new Validator({ age: 25 }, { age: 'numeric' });
      expect(await v.validate()).toBe(true);
    });

    it('passes for numeric strings', async () => {
      const v = new Validator({ age: '25' }, { age: 'numeric' });
      expect(await v.validate()).toBe(true);
    });

    it('fails for non-numeric values', async () => {
      const v = new Validator({ age: 'abc' }, { age: 'numeric' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });
  });

  describe('integer', () => {
    it('passes for integers', async () => {
      const v = new Validator({ count: 5 }, { count: 'integer' });
      expect(await v.validate()).toBe(true);
    });

    it('fails for floats', async () => {
      const v = new Validator({ count: 5.5 }, { count: 'integer' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });
  });

  describe('boolean', () => {
    it('passes for true/false', async () => {
      const v = new Validator({ active: true }, { active: 'boolean' });
      expect(await v.validate()).toBe(true);
    });

    it('passes for string true/false', async () => {
      const v = new Validator({ active: 'true' }, { active: 'boolean' });
      expect(await v.validate()).toBe(true);
    });

    it('passes for 0 and 1', async () => {
      const v = new Validator({ active: 0 }, { active: 'boolean' });
      expect(await v.validate()).toBe(true);
    });

    it('fails for other values', async () => {
      const v = new Validator({ active: 'yes' }, { active: 'boolean' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });
  });

  describe('min', () => {
    it('validates string length', async () => {
      const v = new Validator({ name: 'ab' }, { name: 'min:3' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });

    it('passes when string meets minimum', async () => {
      const v = new Validator({ name: 'abc' }, { name: 'min:3' });
      expect(await v.validate()).toBe(true);
    });

    it('validates numeric value', async () => {
      const v = new Validator({ age: 5 }, { age: 'min:10' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });

    it('passes when number meets minimum', async () => {
      const v = new Validator({ age: 10 }, { age: 'min:10' });
      expect(await v.validate()).toBe(true);
    });
  });

  describe('max', () => {
    it('validates string length', async () => {
      const v = new Validator({ name: 'toolong' }, { name: 'max:3' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });

    it('passes when string within max', async () => {
      const v = new Validator({ name: 'abc' }, { name: 'max:3' });
      expect(await v.validate()).toBe(true);
    });

    it('validates numeric value', async () => {
      const v = new Validator({ age: 150 }, { age: 'max:100' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });
  });

  describe('between', () => {
    it('passes within range for strings', async () => {
      const v = new Validator({ name: 'abc' }, { name: 'between:2,5' });
      expect(await v.validate()).toBe(true);
    });

    it('fails outside range', async () => {
      const v = new Validator({ name: 'a' }, { name: 'between:2,5' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });
  });

  describe('in', () => {
    it('passes for value in list (array format)', async () => {
      // The in rule uses params from colon-split, so each value is a separate colon-param
      // 'in:active:inactive' splits to params=['active','inactive']
      const v = new Validator({ status: 'active' }, { status: 'in:active:inactive' });
      expect(await v.validate()).toBe(true);
    });

    it('fails for value not in list', async () => {
      const v = new Validator({ status: 'pending' }, { status: 'in:active:inactive' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });
  });

  describe('not_in', () => {
    it('passes for value not in list', async () => {
      const v = new Validator({ status: 'active' }, { status: 'not_in:banned:deleted' });
      expect(await v.validate()).toBe(true);
    });

    it('fails for value in list', async () => {
      const v = new Validator({ status: 'banned' }, { status: 'not_in:banned:deleted' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });
  });

  describe('array', () => {
    it('passes for arrays', async () => {
      const v = new Validator({ items: [1, 2, 3] }, { items: 'array' });
      expect(await v.validate()).toBe(true);
    });

    it('fails for non-arrays', async () => {
      const v = new Validator({ items: 'not-array' }, { items: 'array' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });
  });

  describe('confirmed', () => {
    it('passes when confirmation matches', async () => {
      const v = new Validator({ password: 'secret', password_confirmation: 'secret' }, { password: 'confirmed' });
      expect(await v.validate()).toBe(true);
    });

    it('fails when confirmation does not match', async () => {
      const v = new Validator({ password: 'secret', password_confirmation: 'different' }, { password: 'confirmed' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });
  });

  describe('url', () => {
    it('passes for valid URLs', async () => {
      const v = new Validator({ website: 'https://example.com' }, { website: 'url' });
      expect(await v.validate()).toBe(true);
    });

    it('fails for invalid URLs', async () => {
      const v = new Validator({ website: 'not-a-url' }, { website: 'url' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });
  });

  describe('alpha', () => {
    it('passes for letters only', async () => {
      const v = new Validator({ name: 'JohnDoe' }, { name: 'alpha' });
      expect(await v.validate()).toBe(true);
    });

    it('fails for non-letter characters', async () => {
      const v = new Validator({ name: 'John123' }, { name: 'alpha' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });
  });

  describe('alpha_num', () => {
    it('passes for alphanumeric', async () => {
      const v = new Validator({ code: 'abc123' }, { code: 'alpha_num' });
      expect(await v.validate()).toBe(true);
    });

    it('fails for non-alphanumeric', async () => {
      const v = new Validator({ code: 'abc-123' }, { code: 'alpha_num' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });
  });

  describe('alpha_dash', () => {
    it('passes for letters, numbers, dashes, underscores', async () => {
      const v = new Validator({ slug: 'my-post_1' }, { slug: 'alpha_dash' });
      expect(await v.validate()).toBe(true);
    });

    it('fails for other characters', async () => {
      const v = new Validator({ slug: 'my post!' }, { slug: 'alpha_dash' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });
  });

  describe('regex', () => {
    it('passes when value matches pattern', async () => {
      const v = new Validator({ code: 'ABC-123' }, { code: 'regex:^[A-Z]+-\\d+$' });
      expect(await v.validate()).toBe(true);
    });

    it('fails when value does not match', async () => {
      const v = new Validator({ code: 'abc' }, { code: 'regex:^[A-Z]+$' });
      await v.validate();
      expect(v.fails()).toBe(true);
    });
  });

  describe('multiple rules', () => {
    it('validates pipe-separated rules', async () => {
      const v = new Validator({ name: 'Jo' }, { name: 'required|string|min:3' });
      await v.validate();
      expect(v.fails()).toBe(true);
      expect(v.errors()['name']).toBeDefined();
    });

    it('validates array format rules', async () => {
      const v = new Validator({ name: 'John' }, { name: ['required', 'string', 'min:2'] });
      expect(await v.validate()).toBe(true);
    });

    it('validates object format rules', async () => {
      const v = new Validator({ email: 'bad' }, { email: { rule: 'email', message: 'Invalid email' } });
      await v.validate();
      expect(v.fails()).toBe(true);
    });
  });

  describe('dot notation fields', () => {
    it('validates nested fields', async () => {
      const v = new Validator({ address: { city: 'NYC' } }, { 'address.city': 'required|string' });
      expect(await v.validate()).toBe(true);
    });
  });

  describe('custom messages', () => {
    it('uses custom message for specific field rule', async () => {
      const v = new Validator({}, { email: 'required' }, { 'email.required': 'Please provide your email.' });
      await v.validate();
      expect(v.errors()['email'][0]).toBe('Please provide your email.');
    });

    it('uses custom message for rule', async () => {
      const v = new Validator({}, { email: 'required' }, { required: 'This field is mandatory.' });
      await v.validate();
      expect(v.errors()['email'][0]).toBe('This field is mandatory.');
    });
  });

  describe('custom attributes', () => {
    it('uses custom attribute name in messages', async () => {
      const v = new Validator({}, { email_address: 'required' }, {}, { email_address: 'email' });
      await v.validate();
      expect(v.errors()['email_address'][0]).toContain('email');
    });
  });

  describe('validated()', () => {
    it('returns only validated data', async () => {
      const v = new Validator({ name: 'John', age: 25, extra: 'ignored' }, { name: 'required', age: 'numeric' });
      await v.validate();
      const validated = v.validated();
      expect(validated).toEqual({ name: 'John', age: 25 });
      expect(validated).not.toHaveProperty('extra');
    });

    it('excludes fields with errors', async () => {
      const v = new Validator({ name: '', age: 25 }, { name: 'required', age: 'numeric' });
      await v.validate();
      expect(v.validated()).not.toHaveProperty('name');
      expect(v.validated()).toHaveProperty('age');
    });
  });

  describe('passes() / fails()', () => {
    it('passes() returns true when valid', async () => {
      const v = new Validator({ name: 'John' }, { name: 'required' });
      await v.validate();
      expect(v.passes()).toBe(true);
      expect(v.fails()).toBe(false);
    });

    it('fails() returns true when invalid', async () => {
      const v = new Validator({}, { name: 'required' });
      await v.validate();
      expect(v.fails()).toBe(true);
      expect(v.passes()).toBe(false);
    });
  });
});
