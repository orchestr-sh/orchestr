"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const Validator_1 = require("../../src/Foundation/Http/Validator");
(0, vitest_1.describe)('Validator', () => {
    (0, vitest_1.describe)('required', () => {
        (0, vitest_1.it)('fails for undefined value', async () => {
            const v = new Validator_1.Validator({}, { name: 'required' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
            (0, vitest_1.expect)(v.errors()['name']).toBeDefined();
        });
        (0, vitest_1.it)('fails for null value', async () => {
            const v = new Validator_1.Validator({ name: null }, { name: 'required' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
        (0, vitest_1.it)('fails for empty string', async () => {
            const v = new Validator_1.Validator({ name: '' }, { name: 'required' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
        (0, vitest_1.it)('passes for non-empty value', async () => {
            const v = new Validator_1.Validator({ name: 'John' }, { name: 'required' });
            const result = await v.validate();
            (0, vitest_1.expect)(result).toBe(true);
            (0, vitest_1.expect)(v.passes()).toBe(true);
        });
    });
    (0, vitest_1.describe)('email', () => {
        (0, vitest_1.it)('passes for valid email', async () => {
            const v = new Validator_1.Validator({ email: 'user@example.com' }, { email: 'email' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('fails for invalid email', async () => {
            const v = new Validator_1.Validator({ email: 'not-an-email' }, { email: 'email' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
        (0, vitest_1.it)('passes for undefined (not required)', async () => {
            const v = new Validator_1.Validator({}, { email: 'email' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
    });
    (0, vitest_1.describe)('string', () => {
        (0, vitest_1.it)('passes for string values', async () => {
            const v = new Validator_1.Validator({ name: 'hello' }, { name: 'string' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('fails for non-string values', async () => {
            const v = new Validator_1.Validator({ name: 123 }, { name: 'string' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
    });
    (0, vitest_1.describe)('numeric', () => {
        (0, vitest_1.it)('passes for numbers', async () => {
            const v = new Validator_1.Validator({ age: 25 }, { age: 'numeric' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('passes for numeric strings', async () => {
            const v = new Validator_1.Validator({ age: '25' }, { age: 'numeric' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('fails for non-numeric values', async () => {
            const v = new Validator_1.Validator({ age: 'abc' }, { age: 'numeric' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
    });
    (0, vitest_1.describe)('integer', () => {
        (0, vitest_1.it)('passes for integers', async () => {
            const v = new Validator_1.Validator({ count: 5 }, { count: 'integer' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('fails for floats', async () => {
            const v = new Validator_1.Validator({ count: 5.5 }, { count: 'integer' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
    });
    (0, vitest_1.describe)('boolean', () => {
        (0, vitest_1.it)('passes for true/false', async () => {
            const v = new Validator_1.Validator({ active: true }, { active: 'boolean' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('passes for string true/false', async () => {
            const v = new Validator_1.Validator({ active: 'true' }, { active: 'boolean' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('passes for 0 and 1', async () => {
            const v = new Validator_1.Validator({ active: 0 }, { active: 'boolean' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('fails for other values', async () => {
            const v = new Validator_1.Validator({ active: 'yes' }, { active: 'boolean' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
    });
    (0, vitest_1.describe)('min', () => {
        (0, vitest_1.it)('validates string length', async () => {
            const v = new Validator_1.Validator({ name: 'ab' }, { name: 'min:3' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
        (0, vitest_1.it)('passes when string meets minimum', async () => {
            const v = new Validator_1.Validator({ name: 'abc' }, { name: 'min:3' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('validates numeric value', async () => {
            const v = new Validator_1.Validator({ age: 5 }, { age: 'min:10' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
        (0, vitest_1.it)('passes when number meets minimum', async () => {
            const v = new Validator_1.Validator({ age: 10 }, { age: 'min:10' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
    });
    (0, vitest_1.describe)('max', () => {
        (0, vitest_1.it)('validates string length', async () => {
            const v = new Validator_1.Validator({ name: 'toolong' }, { name: 'max:3' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
        (0, vitest_1.it)('passes when string within max', async () => {
            const v = new Validator_1.Validator({ name: 'abc' }, { name: 'max:3' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('validates numeric value', async () => {
            const v = new Validator_1.Validator({ age: 150 }, { age: 'max:100' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
    });
    (0, vitest_1.describe)('between', () => {
        (0, vitest_1.it)('passes within range for strings', async () => {
            const v = new Validator_1.Validator({ name: 'abc' }, { name: 'between:2,5' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('fails outside range', async () => {
            const v = new Validator_1.Validator({ name: 'a' }, { name: 'between:2,5' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
    });
    (0, vitest_1.describe)('in', () => {
        (0, vitest_1.it)('passes for value in list (array format)', async () => {
            // The in rule uses params from colon-split, so each value is a separate colon-param
            // 'in:active:inactive' splits to params=['active','inactive']
            const v = new Validator_1.Validator({ status: 'active' }, { status: 'in:active:inactive' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('fails for value not in list', async () => {
            const v = new Validator_1.Validator({ status: 'pending' }, { status: 'in:active:inactive' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
    });
    (0, vitest_1.describe)('not_in', () => {
        (0, vitest_1.it)('passes for value not in list', async () => {
            const v = new Validator_1.Validator({ status: 'active' }, { status: 'not_in:banned:deleted' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('fails for value in list', async () => {
            const v = new Validator_1.Validator({ status: 'banned' }, { status: 'not_in:banned:deleted' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
    });
    (0, vitest_1.describe)('array', () => {
        (0, vitest_1.it)('passes for arrays', async () => {
            const v = new Validator_1.Validator({ items: [1, 2, 3] }, { items: 'array' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('fails for non-arrays', async () => {
            const v = new Validator_1.Validator({ items: 'not-array' }, { items: 'array' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
    });
    (0, vitest_1.describe)('confirmed', () => {
        (0, vitest_1.it)('passes when confirmation matches', async () => {
            const v = new Validator_1.Validator({ password: 'secret', password_confirmation: 'secret' }, { password: 'confirmed' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('fails when confirmation does not match', async () => {
            const v = new Validator_1.Validator({ password: 'secret', password_confirmation: 'different' }, { password: 'confirmed' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
    });
    (0, vitest_1.describe)('url', () => {
        (0, vitest_1.it)('passes for valid URLs', async () => {
            const v = new Validator_1.Validator({ website: 'https://example.com' }, { website: 'url' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('fails for invalid URLs', async () => {
            const v = new Validator_1.Validator({ website: 'not-a-url' }, { website: 'url' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
    });
    (0, vitest_1.describe)('alpha', () => {
        (0, vitest_1.it)('passes for letters only', async () => {
            const v = new Validator_1.Validator({ name: 'JohnDoe' }, { name: 'alpha' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('fails for non-letter characters', async () => {
            const v = new Validator_1.Validator({ name: 'John123' }, { name: 'alpha' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
    });
    (0, vitest_1.describe)('alpha_num', () => {
        (0, vitest_1.it)('passes for alphanumeric', async () => {
            const v = new Validator_1.Validator({ code: 'abc123' }, { code: 'alpha_num' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('fails for non-alphanumeric', async () => {
            const v = new Validator_1.Validator({ code: 'abc-123' }, { code: 'alpha_num' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
    });
    (0, vitest_1.describe)('alpha_dash', () => {
        (0, vitest_1.it)('passes for letters, numbers, dashes, underscores', async () => {
            const v = new Validator_1.Validator({ slug: 'my-post_1' }, { slug: 'alpha_dash' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('fails for other characters', async () => {
            const v = new Validator_1.Validator({ slug: 'my post!' }, { slug: 'alpha_dash' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
    });
    (0, vitest_1.describe)('regex', () => {
        (0, vitest_1.it)('passes when value matches pattern', async () => {
            const v = new Validator_1.Validator({ code: 'ABC-123' }, { code: 'regex:^[A-Z]+-\\d+$' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('fails when value does not match', async () => {
            const v = new Validator_1.Validator({ code: 'abc' }, { code: 'regex:^[A-Z]+$' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
    });
    (0, vitest_1.describe)('multiple rules', () => {
        (0, vitest_1.it)('validates pipe-separated rules', async () => {
            const v = new Validator_1.Validator({ name: 'Jo' }, { name: 'required|string|min:3' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
            (0, vitest_1.expect)(v.errors()['name']).toBeDefined();
        });
        (0, vitest_1.it)('validates array format rules', async () => {
            const v = new Validator_1.Validator({ name: 'John' }, { name: ['required', 'string', 'min:2'] });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
        (0, vitest_1.it)('validates object format rules', async () => {
            const v = new Validator_1.Validator({ email: 'bad' }, { email: { rule: 'email', message: 'Invalid email' } });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
        });
    });
    (0, vitest_1.describe)('dot notation fields', () => {
        (0, vitest_1.it)('validates nested fields', async () => {
            const v = new Validator_1.Validator({ address: { city: 'NYC' } }, { 'address.city': 'required|string' });
            (0, vitest_1.expect)(await v.validate()).toBe(true);
        });
    });
    (0, vitest_1.describe)('custom messages', () => {
        (0, vitest_1.it)('uses custom message for specific field rule', async () => {
            const v = new Validator_1.Validator({}, { email: 'required' }, { 'email.required': 'Please provide your email.' });
            await v.validate();
            (0, vitest_1.expect)(v.errors()['email'][0]).toBe('Please provide your email.');
        });
        (0, vitest_1.it)('uses custom message for rule', async () => {
            const v = new Validator_1.Validator({}, { email: 'required' }, { required: 'This field is mandatory.' });
            await v.validate();
            (0, vitest_1.expect)(v.errors()['email'][0]).toBe('This field is mandatory.');
        });
    });
    (0, vitest_1.describe)('custom attributes', () => {
        (0, vitest_1.it)('uses custom attribute name in messages', async () => {
            const v = new Validator_1.Validator({}, { email_address: 'required' }, {}, { email_address: 'email' });
            await v.validate();
            (0, vitest_1.expect)(v.errors()['email_address'][0]).toContain('email');
        });
    });
    (0, vitest_1.describe)('validated()', () => {
        (0, vitest_1.it)('returns only validated data', async () => {
            const v = new Validator_1.Validator({ name: 'John', age: 25, extra: 'ignored' }, { name: 'required', age: 'numeric' });
            await v.validate();
            const validated = v.validated();
            (0, vitest_1.expect)(validated).toEqual({ name: 'John', age: 25 });
            (0, vitest_1.expect)(validated).not.toHaveProperty('extra');
        });
        (0, vitest_1.it)('excludes fields with errors', async () => {
            const v = new Validator_1.Validator({ name: '', age: 25 }, { name: 'required', age: 'numeric' });
            await v.validate();
            (0, vitest_1.expect)(v.validated()).not.toHaveProperty('name');
            (0, vitest_1.expect)(v.validated()).toHaveProperty('age');
        });
    });
    (0, vitest_1.describe)('passes() / fails()', () => {
        (0, vitest_1.it)('passes() returns true when valid', async () => {
            const v = new Validator_1.Validator({ name: 'John' }, { name: 'required' });
            await v.validate();
            (0, vitest_1.expect)(v.passes()).toBe(true);
            (0, vitest_1.expect)(v.fails()).toBe(false);
        });
        (0, vitest_1.it)('fails() returns true when invalid', async () => {
            const v = new Validator_1.Validator({}, { name: 'required' });
            await v.validate();
            (0, vitest_1.expect)(v.fails()).toBe(true);
            (0, vitest_1.expect)(v.passes()).toBe(false);
        });
    });
});
//# sourceMappingURL=Validator.test.js.map