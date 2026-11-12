/**
 * Validation parity - the features that close the gap with Laravel's
 * validator: wildcard (`users.*.email`) expansion with concrete error
 * keys, exclude/required modifiers bound to wildcard paths, `bail` and
 * `stopOnFirstFailure`, `after` hooks, `sometimes` with nested data,
 * custom rule extension (`Validator.extend`/`extendImplicit`/`replacer`),
 * the `current_password`/`can`/`list`/`required_array_keys` rules, the
 * fluent password rule, and `Request.validate` / `Controller.validate`.
 */

import { createAuthApp, testHasher } from '@tests/Auth/support';
import { createRawRequest } from '@tests/Session/support';
import { afterEach, describe, expect, it } from 'vitest';
import type { Gate } from '@/Auth/Access/Gate';
import type { ValidationRules } from '@/Foundation/Http/Validator';
import { Response } from '@/Auth/Access/Response';
import { Application } from '@/Foundation/Application';
import { Rule } from '@/Foundation/Http/Rule';
import { ValidationException } from '@/Foundation/Http/ValidationException';
import { Validator } from '@/Foundation/Http/Validator';
import { Controller } from '@/Routing/Controller';
import { Request } from '@/Routing/Request';

/**
 * JSON request carrying the given body, ready for parseBody()
 */
function jsonRequest(body: Record<string, any>): Request {
  return new Request(
    createRawRequest('POST', '/validated', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

async function validate(data: Record<string, any>, rules: ValidationRules): Promise<Validator> {
  const validator = Validator.make(data, rules);
  await validator.validate();

  return validator;
}

describe('wildcard and nested validation', () => {
  it('validates each item and reports errors with concrete keys', async () => {
    const v = await validate(
      { users: [{ email: 'ada@example.com' }, { email: 'not-an-email' }] },
      { 'users.*.email': 'required|email' }
    );

    expect(v.fails()).toBe(true);
    expect(Object.keys(v.errors())).toEqual(['users.1.email']);
    expect(v.errors()['users.1.email'][0]).toContain('valid email');
  });

  it('fires presence rules for keys missing inside expanded items', async () => {
    const v = await validate({ users: [{}, {}] }, { 'users.*.email': 'required' });

    expect(Object.keys(v.errors()).sort()).toEqual(['users.0.email', 'users.1.email']);
  });

  it('expands wildcards over keyed objects too', async () => {
    const v = await validate({ groups: { admin: { name: 123 }, ops: { name: 'ok' } } }, { 'groups.*.name': 'string' });

    expect(Object.keys(v.errors())).toEqual(['groups.admin.name']);
  });

  it('validates the expanded items themselves with a trailing wildcard', async () => {
    const v = await validate({ users: ['ada', { name: 'bo' }] }, { 'users.*': 'string' });

    expect(Object.keys(v.errors())).toEqual(['users.1']);
  });

  it('builds nested validated data for wildcard attributes', async () => {
    const v = await validate(
      { users: [{ email: 'a@example.com' }, { email: 'b@example.com' }] },
      { 'users.*.email': 'required|email' }
    );

    expect(v.validated()).toEqual({ users: [{ email: 'a@example.com' }, { email: 'b@example.com' }] });
  });

  it('resolves custom messages and attributes through the wildcard pattern', async () => {
    const v = new Validator(
      { users: [{ email: 'bad' }] },
      { 'users.*.email': 'required|email' },
      { 'users.*.email.email': ':attribute looks wrong' },
      { 'users.*.email': 'email address' }
    );

    await v.validate();

    expect(v.errors()['users.0.email']).toEqual(['email address looks wrong']);
  });

  it('skips expansion entirely when the wildcard parent is missing', async () => {
    const v = await validate({}, { 'users.*.email': 'required|email' });

    expect(v.passes()).toBe(true);
  });

  it('binds required_if wildcard parameters to the same item', async () => {
    const v = await validate(
      {
        items: [
          { type: 'card', cc: '' },
          { type: 'cash', cc: 'x' },
        ],
      },
      { 'items.*.cc': 'required_if:items.*.type,card' }
    );

    expect(Object.keys(v.errors())).toEqual(['items.0.cc']);
  });

  it('binds exclude_if wildcard parameters and drops excluded items from validated data', async () => {
    const v = await validate(
      { users: [{ type: 'x', license: 'OLD' }, { type: 'y', license: 'L' }, { type: 'z' }] },
      { 'users.*.license': 'exclude_if:users.*.type,x|required' }
    );

    // users.0 is excluded (its license would otherwise fail nothing but
    // never lands in validated data), users.2 misses the required license
    expect(Object.keys(v.errors())).toEqual(['users.2.license']);
    expect(v.validated()).toEqual({ users: [undefined, { license: 'L' }] });
  });

  it('keeps array-style conditional rules working at the top level', async () => {
    const v = await validate({ type: 'card', cc: '' }, { cc: 'required_if:type,card' });

    expect(v.fails()).toBe(true);
    expect(v.errors().cc[0]).toContain('required');
  });

  it('supports multiple expected values on prohibited_if like required_if', async () => {
    const v = await validate({ role: 'admin', reason: 'because' }, { reason: 'prohibited_if:role,admin,owner' });
    expect(v.fails()).toBe(true);

    const pass = await validate({ role: 'user', reason: 'because' }, { reason: 'prohibited_if:role,admin,owner' });
    expect(pass.passes()).toBe(true);
  });

  it('sometimes skips missing items of a wildcard list', async () => {
    const v = await validate({ users: [{}, { nickname: 'ab' }] }, { 'users.*.nickname': 'sometimes|string|min:3' });

    expect(Object.keys(v.errors())).toEqual(['users.1.nickname']);
  });

  it('applies list, required_array_keys and keyed array rules', async () => {
    const list = await validate({ tags: [1, 2, 3] }, { tags: 'list' });
    expect(list.passes()).toBe(true);

    const notList = await validate({ tags: { a: 1 } }, { tags: 'list' });
    expect(notList.fails()).toBe(true);
    expect(notList.errors().tags[0]).toContain('must be a list');

    const keysOk = await validate(
      { profile: { name: 'Ada', email: 'a@x.io' } },
      { profile: 'required_array_keys:name,email' }
    );
    expect(keysOk.passes()).toBe(true);

    const keysMissing = await validate({ profile: { name: 'Ada' } }, { profile: 'required_array_keys:name,email' });
    expect(keysMissing.fails()).toBe(true);
    expect(keysMissing.errors().profile[0]).toContain('must contain keys: name, email.');

    const keysNotArray = await validate({ profile: 'nope' }, { profile: 'required_array_keys:name' });
    expect(keysNotArray.fails()).toBe(true);

    const arrayKeys = await validate({ flags: { a: 1, b: 2 } }, { flags: 'array:a,b' });
    expect(arrayKeys.passes()).toBe(true);

    const arrayExtraKey = await validate({ flags: { a: 1, c: 3 } }, { flags: 'array:a,b' });
    expect(arrayExtraKey.fails()).toBe(true);
  });

  it('excluded attributes never reach validated data', async () => {
    const v = await validate({ type: 'card', cc: '123' }, { cc: 'exclude_if:type,card' });

    expect(v.passes()).toBe(true);
    expect(v.validated()).not.toHaveProperty('cc');
  });
});

describe('bail and stopOnFirstFailure', () => {
  it('bail stops validating a field after the first failure', async () => {
    const v = await validate(
      { name: 'ab', age: undefined },
      { name: 'bail|min:3|string|starts_with:zz', age: 'required' }
    );

    // name fails min:3 only; the other fields keep being validated
    expect(v.errors().name).toHaveLength(1);
    expect(v.errors().name[0]).toContain('at least 3');
    expect(v.errors().age).toBeDefined();
  });

  it('without bail every failing rule reports an error', async () => {
    const v = await validate({ name: 'ab' }, { name: 'min:3|starts_with:zz' });

    expect(v.errors().name).toHaveLength(2);
  });

  it('stopOnFirstFailure aborts the whole run at the first error', async () => {
    const v = Validator.make({ first: '', second: '' }, { first: 'required', second: 'required' });
    v.stopOnFirstFailure();

    expect(await v.validate()).toBe(false);
    expect(Object.keys(v.errors())).toEqual(['first']);
    expect(v.errors().first).toHaveLength(1);
  });
});

describe('after hooks', () => {
  it('can add errors after the regular rules ran', async () => {
    const v = Validator.make({ coupon: 'expired' }, { coupon: 'required|string' });

    v.after((validator) => {
      if (validator.validated().coupon === 'expired') {
        validator.addError('coupon', 'This coupon has expired.');
      }
    });

    expect(await v.validate()).toBe(false);
    expect(v.errors().coupon).toContain('This coupon has expired.');
  });

  it('awaits async hooks and keeps passes clean when they add nothing', async () => {
    const v = Validator.make({ coupon: 'fresh' }, { coupon: 'string' });

    v.after(async (validator) => {
      await Promise.resolve();
      if (validator.validated().coupon === 'stale') {
        validator.addError('coupon', 'stale');
      }
    });

    expect(await v.validate()).toBe(true);
  });
});

describe('custom rule extension', () => {
  afterEach(() => {
    Validator.forgetExtension('even');
    Validator.forgetExtension('shouty');
    Validator.replacer((message) => message);
  });

  it('Validator.extend works from string rules', async () => {
    Validator.extend('even', (_attribute, value) => Number(value) % 2 === 0);

    const ok = await validate({ n: 4 }, { n: 'required|even' });
    expect(ok.passes()).toBe(true);

    const failed = await validate({ n: 3 }, { n: 'even' });
    expect(failed.fails()).toBe(true);
    expect(failed.errors().n).toEqual(['The n is invalid.']);

    // messages map still wins over the extension default
    const messaged = new Validator({ n: 3 }, { n: 'even' }, { 'n.even': 'needs to be even' });
    await messaged.validate();
    expect(messaged.errors().n).toEqual(['needs to be even']);
  });

  it('extend takes parameters and a default message', async () => {
    Validator.extend(
      'shouty',
      (_attribute, value, parameters) => String(value).toUpperCase() === value && String(value) !== parameters[0],
      ':attribute must be shouted'
    );

    const v = await validate({ name: 'ada' }, { name: 'shouty:ada' });

    expect(v.errors().name).toEqual(['name must be shouted']);
  });

  it('custom rules skip missing values while extendImplicit runs regardless', async () => {
    let calls = 0;
    Validator.extend('even', () => {
      calls++;
      return true;
    });

    await validate({}, { n: 'even' });
    expect(calls).toBe(0);

    Validator.extendImplicit('even', () => {
      calls++;
      return false;
    });

    const v = await validate({}, { n: 'even' });
    expect(calls).toBe(1);
    expect(v.fails()).toBe(true);
  });

  it('replacer rewrites every resolved message', async () => {
    Validator.replacer((message) => message.replace('is required', 'MISSING'));

    const v = await validate({}, { name: 'required' });

    expect(v.errors().name).toEqual(['The name field MISSING.']);
  });

  it('Validator.make is a factory for the constructor arguments', () => {
    const v = Validator.make({ a: 1 }, { a: 'integer' }, { 'a.integer': 'nope' }, { a: 'ay' });

    expect(v).toBeInstanceOf(Validator);
    expect(v).toHaveProperty('validate');
  });
});

describe('password rule', () => {
  it('enforces the minimum length by default', async () => {
    const short = await validate({ password: 'abc' }, { password: [Rule.password()] });
    expect(short.errors().password).toEqual(['The password must be at least 8 characters.']);

    const ok = await validate({ password: 'longenough' }, { password: [Rule.password()] });
    expect(ok.passes()).toBe(true);
  });

  it('applies letters, mixed case, numbers and symbols options', async () => {
    const noLetters = await validate({ pw: '12345678' }, { pw: [Rule.password().min(8).letters()] });
    expect(noLetters.errors().pw[0]).toContain('must contain letters');

    const oneCase = await validate({ pw: 'abcdefgh' }, { pw: [Rule.password().mixedCase()] });
    expect(oneCase.errors().pw[0]).toContain('mixed case');

    const noNumbers = await validate({ pw: 'Abcdefgh' }, { pw: [Rule.password().numbers()] });
    expect(noNumbers.errors().pw[0]).toContain('must contain numbers');

    const noSymbols = await validate({ pw: 'Abcdefg1' }, { pw: [Rule.password().symbols()] });
    expect(noSymbols.errors().pw[0]).toContain('must contain symbols');

    const strong = await validate({ pw: 'Abcdefg1!' }, { pw: [Rule.password().symbols().numbers().mixedCase()] });
    expect(strong.passes()).toBe(true);
  });

  it('uncompromised rejects locally known leaked passwords without touching the network', async () => {
    const leaked = await validate({ pw: 'password' }, { pw: [Rule.password().uncompromised()] });
    expect(leaked.errors().pw[0]).toContain('data leak');

    const safe = await validate({ pw: 'Tr0ub4dor&3' }, { pw: [Rule.password().uncompromised()] });
    expect(safe.passes()).toBe(true);
  });

  it('the password string rule applies the defaults', async () => {
    const v = await validate({ pw: 'short' }, { pw: 'password' });
    expect(v.errors().pw).toEqual(['The pw must be at least 8 characters.']);
  });

  it('password skips missing values; chain required to enforce presence', async () => {
    const v = await validate({}, { pw: 'password' });
    expect(v.passes()).toBe(true);
  });
});

describe('current_password', () => {
  /**
   * Boot a minimal app whose 'auth' guard resolves the given user and
   * whose 'hash' service is the shared scrypt test hasher; the guard
   * name passed by the rule is intentionally ignored by the fake
   */
  function appWithUser(password: string | null) {
    const app = new Application('/test');
    const hasher = testHasher();
    const stored = password === null ? null : hasher.make(password);

    app.instance('hash', hasher);
    app.instance('auth', {
      guard: () => ({ user: async () => (stored === null ? null : { getAuthPassword: () => stored }) }),
    } as any);

    return app;
  }

  it('checks the authenticated user password through the auth guard', async () => {
    appWithUser('secret');

    const ok = await validate({ password: 'secret' }, { password: 'current_password' });
    expect(ok.passes()).toBe(true);

    const wrong = await validate({ password: 'nope' }, { password: 'current_password' });
    expect(wrong.fails()).toBe(true);
    expect(wrong.errors().password).toEqual(['The password does not match the current password.']);
  });

  it('fails when the guard has no authenticated user', async () => {
    appWithUser(null);

    const v = await validate({ password: 'secret' }, { password: 'current_password' });

    expect(v.fails()).toBe(true);
    expect(v.errors().password[0]).toContain('does not match');
  });

  it('accepts the guard name and works through the Rule builder', async () => {
    appWithUser('hunter2');

    const v = await validate({ pwd: 'hunter2' }, { pwd: [Rule.currentPassword('web')] });

    expect(v.passes()).toBe(true);
  });

  it('throws when authentication is not registered', async () => {
    new Application('/test');

    await expect(validate({ password: 'x' }, { password: 'current_password' })).rejects.toThrow(
      /Authentication is not available/
    );
  });
});

describe('can rule and the gate', () => {
  it('Rule.can validates through the Gate', async () => {
    const context = await createAuthApp();
    const gate = context.app.make<Gate>('gate');
    gate.resolveUsersUsing(() => null);
    gate.define('publish', (_user, allowed) => allowed === true);

    const allowed = await validate({ title: 'x' }, { title: [Rule.required(), Rule.can('publish', true)] });
    expect(allowed.passes()).toBe(true);

    const denied = await validate({ title: 'x' }, { title: [Rule.required(), Rule.can('publish', false)] });
    expect(denied.fails()).toBe(true);
    expect(denied.errors().title).toEqual(['The title is invalid.']);
  });

  it('the can string rule passes field values as ability arguments', async () => {
    const context = await createAuthApp();
    const gate = context.app.make<Gate>('gate');
    gate.resolveUsersUsing(() => null);
    gate.define('check-flag', (_user, flag) => flag === true);

    const ok = await validate({ flag: true, confirm: 1 }, { confirm: 'can:check-flag,flag' });
    expect(ok.passes()).toBe(true);

    const denied = await validate({ flag: false, confirm: 1 }, { confirm: 'can:check-flag,flag' });
    expect(denied.fails()).toBe(true);
    expect(denied.errors().confirm).toEqual(['The confirm is invalid.']);
  });

  it('surfaces the gate denial message when the ability provides one', async () => {
    const context = await createAuthApp();
    const gate = context.app.make<Gate>('gate');
    gate.resolveUsersUsing(() => null);
    gate.define('limited', () => Response.deny('Only editors may edit.'));

    const v = await validate({ title: 'x' }, { title: 'can:limited' });

    expect(v.errors().title).toEqual(['Only editors may edit.']);
  });
});

describe('Controller.validate and Request.validate', () => {
  class SignupController extends Controller {
    async store(request: Request): Promise<Record<string, any>> {
      return this.validate(request, {
        name: 'required|string|min:2',
        email: 'required|email',
        'users.*.email': 'email',
      });
    }
  }

  it('Request.validate throws ValidationException carrying the error bag', async () => {
    const request = jsonRequest({ name: 'Ada', email: 'not-an-email' });
    await request.parseBody();

    try {
      await request.validate({ name: 'required', email: 'required|email' });
      expect.unreachable('expected a ValidationException');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationException);
      expect((error as ValidationException).errors().email).toBeDefined();
      expect((error as ValidationException).status).toBe(422);
    }
  });

  it('Request.validate returns only the validated data', async () => {
    const request = jsonRequest({ name: 'Ada', extra: 'ignored' });
    await request.parseBody();

    const validated = await request.validate({ name: 'required|string' });

    expect(validated).toEqual({ name: 'Ada' });
  });

  it('Controller.validate actually validates instead of passing input through', async () => {
    const controller = new SignupController();
    const request = jsonRequest({ name: 'A', email: 'bad', users: [{ email: 'ok@example.com' }] });
    await request.parseBody();

    await expect(controller.store(request)).rejects.toBeInstanceOf(ValidationException);

    const good = jsonRequest({ name: 'Ada', email: 'ada@example.com', users: [{ email: 'a@example.com' }] });
    await good.parseBody();

    const validated = await controller.store(good);
    expect(validated).toEqual({ name: 'Ada', email: 'ada@example.com', users: [{ email: 'a@example.com' }] });
  });
});
