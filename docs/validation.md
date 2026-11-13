# Validation Usage

This guide shows how to validate request data using the Validator and the Rule builder. It covers defining rules, conditional logic, arrays, dates, numbers, networks and files, plus customizing error messages.

## Quick Start

- Create a Validator with input data and a rules object.
- Use the Rule builder to compose rule instances.
- Call `validate()` to run rules; read `errors()` for messages.

```ts
import { Validator } from '@/Foundation/Http/Validator';
import { Rule } from '@/Foundation/Http/Rule';

const data = { email: 'user@example.com', age: 18 };
const rules = {
  email: [Rule.required(), Rule.email()],
  age: [Rule.required(), Rule.integer(), Rule.min(18)],
};

const v = new Validator(data, rules);
const ok = await v.validate(); // true/false
const errs = v.errors(); // { email?: string[], age?: string[] }
```

## Rule Builder

Use `Rule.*()` methods to construct validation rules. Every call returns a rule object. Common examples:

- Presence: `required()`, `present()`, `filled()`, `nullable()`, `sometimes()`
- Strings: `string()`, `alpha()`, `alphaNum()`, `alphaDash()`, `lowercase()`, `uppercase()`, `ascii()`
- Patterns: `regex(/.../)`, `notRegex(/.../)`, `email()`, `json()`
- Numbers: `numeric()`, `integer()`, `decimal(places?)`, `min(n)`, `max(n)`, `between(min,max)`, `size(n)`
- Digits: `digits(n)`, `digitsBetween(min,max)`, `minDigits(n)`, `maxDigits(n)`, `multipleOf(n)`
- Comparison: `gt(fieldOrValue)`, `gte(fieldOrValue)`, `lt(fieldOrValue)`, `lte(fieldOrValue)`
- Arrays: `array()`, `list()`, `requiredArrayKeys([...])`, `distinct()`, `in([...])`, `notIn([...])`, `inArray(field)`
- Dates: `date()`, `dateEquals(date)`, `after(dateOrField)`, `afterOrEqual(...)`, `before(...)`, `beforeOrEqual(...)`
- Network: `url()`, `activeUrl()`, `ip()`, `ipv4()`, `ipv6()`, `macAddress()`, `uuid()`, `timezone()`
- Files: `file()`, `image()`, `mimetypes([...])`, `mimes([...])`
- Conditionals: `accepted()`, `acceptedIf(field,val)`, `declined()`, `declinedIf(field,val)`

## Nested and Array Data

Rules can target nested values with dot notation and wildcard paths. Every
`*` is expanded against the data, and errors are reported with concrete
keys (`users.1.email`), while custom messages/attributes may stay keyed by
the pattern (`users.*.email`):

```ts
const rules = {
  users: [Rule.array()],
  'users.*.email': 'required|email',
  'items.*.price': 'required|numeric|min:0',
};

const v = new Validator(
  { users: [{ email: 'ada@example.com' }, { email: 'nope' }] },
  rules
);
await v.validate();
v.errors(); // { 'users.1.email': ['The users.1.email must be a valid email address.'] }
```

- Wildcards also bind inside dependent-field parameters:
  `'users.*.license': 'exclude_if:users.*.type,x|required'` compares each
  item against its own `type` value.
- `sometimes` skips expanded items whose key is missing, so partial
  updates of nested lists behave like top-level `sometimes`.
- Key rules: `array` (also `array:a,b` to pin allowed keys), `list`
  (sequential integer keys), `required_array_keys:name,email` (object must
  carry the keys), `distinct` (no duplicates in an array value).
- `validated()` rebuilds the nested structure: wildcard rules yield
  `{ users: [{ email: ... }] }` rather than flat dotted keys.

## Control Flow: bail, stopOnFirstFailure, after

- `bail` (per attribute) stops validating that attribute after its first
  failing rule: `{ name: 'bail|required|min:3' }`.
- `Validator.stopOnFirstFailure()` aborts the whole run at the first
  error of any attribute.
- `after(callback)` hooks run once every attribute has been checked and
  can add further errors via `validator.addError(key, message)` - the
  cross-field equivalent of Laravel's `$validator->errors()->add(...)`.

```ts
const v = new Validator(data, rules);
v.after((validator) => {
  if (validator.validated().coupon === 'expired') {
    validator.addError('coupon', 'This coupon has expired.');
  }
});
```

## Custom Rules

`Validator.extend` registers a rule name the string parser understands -
the same registry `Rule` objects resolve through, so `['required', 'even']`
and `Rule.*()` forms both pick it up:

```ts
Validator.extend('even', (_attribute, value) => Number(value) % 2 === 0);
Validator.extend('shouty', (_attribute, value, params) => ..., ':attribute must be shouted');

Validator.extendImplicit('banned', (attribute, value) => ...); // runs even for missing values
Validator.replacer((message) => message.replace('is required', 'MISSING'));
Validator.forgetExtension('even');
```

Custom rules skip attributes whose value is missing unless registered with
`extendImplicit`. `Validator.make(data, rules, messages?, attributes?)` is
a factory alternative to `new Validator(...)`.

## Conditional Presence

Require a field based on other inputs:

```ts
const rules = {
  type: [Rule.required(), Rule.string()],
  cc: [Rule.requiredIf('type', 'card')], // required when type == 'card'
};
```

Other variants:

- `requiredUnless(field, val)`
- `requiredWith(...fields)`
- `requiredWithAll(...fields)`
- `requiredWithout(...fields)`
- `requiredWithoutAll(...fields)`

Prohibited variants:

- `prohibited()`
- `prohibitedIf(field, val)`
- `prohibitedUnless(field, val)`
- `prohibits(...fields)` (current field prohibits the listed fields)

## Starts/Ends With

```ts
const rules = {
  slug: [Rule.startsWith(['user']), Rule.endsWith(['admin'])],
};
```

## Comparisons

Compare against another field or literal:

```ts
const rules = {
  max: [Rule.gt('min')],       // max > min
  threshold: [Rule.gte(10)],   // threshold >= 10
};
```

## Arrays

```ts
const rules = {
  tags: [Rule.array(), Rule.distinct()],
  choice: [Rule.inArray('choices')],
  status: [Rule.in(['open', 'closed'])],
};
```

## Dates

```ts
const rules = {
  start: [Rule.date(), Rule.after('2020-01-01')],
  end: [Rule.date(), Rule.afterOrEqual('start')],
};
```

## Files

`file`, `image`, `mimes` and `mimetypes` accept `UploadedFile` instances
straight out of a multipart request (`request.all()` carries them alongside
text input, so FormRequest rules apply to uploads too):

```ts
const rules = {
  avatar: [Rule.file(), Rule.image(), Rule.mimes(['png','jpg'])],
  doc: [Rule.file(), Rule.mimetypes(['application/pdf'])],
};
```

- `file` passes only uploads whose transfer succeeded (`getError() === UPLOAD_ERR_OK`).
- `image`, `mimes` and `mimetypes` sniff the file's bytes (magic signatures)
  and fall back to the client-reported type, so a text file renamed `.png`
  fails `mimes:png`.
- `min`, `max` and `size` measure uploads in kilobytes; strings and numbers
  keep their character/value meanings.
- `dimensions` reads raster headers - `dimensions:min_width=100,max_height=600`
  or `Rule.dimensions({ minWidth: 100 })`.
- Plain objects exposing `mimetype`/`extension`/`width`/`height` are still
  validated structurally for non-HTTP callers.

## Custom Messages

Pass per-field messages via the Validator:

```ts
const messages = {
  'email.required': 'Email is required',
  'email.email': 'Email must be valid',
};
const v = new Validator(data, rules, messages);
```

Messages may reference `:attribute`, which is replaced with the field's
display name (the `attributes` argument or the humanized field). For
wildcard rules, key messages/attributes by the pattern -
`messages['users.*.email.required']` covers every expanded item, and the
concrete key (`'users.0.email.required'`) still wins when both are set.

Rule classes may also provide tailored messages (`->message()` on
invokable rules or `{ rule, message }` objects); an inline message wins
over both the defaults and the messages map.

## Form Requests

Encapsulate validation by extending `FormRequest`. Define `rules()` and `messages()` then call `validated()`:

```ts
import { FormRequest } from '@/Foundation/Http/FormRequest';
import { Rule } from '@/Foundation/Http/Rule';

class CreateUserRequest extends FormRequest {
  rules() {
    return {
      email: [Rule.required(), Rule.email()],
      password: [Rule.required(), Rule.string(), Rule.min(8)],
    };
  }
  messages() {
    return {
      'password.min': 'Password must be at least 8 characters',
    };
  }
}
```

Use it in your controller/handler to validate and access sanitized inputs.
Injected `FormRequest` parameters are validated before the action runs: a
failure throws `ValidationException` (rendered as 422 with the error bag) and
an `authorize()` denial throws `AccessDeniedHttpException` (rendered as 403) -
both through the shared exception handler.

## Request and Controller Validation

`Request.validate(rules, messages?, attributes?)` runs the Validator over the
request's input (`all()`, uploads included), throws `ValidationException` on
failure and returns the validated data on success. The base `Controller`
exposes the same behaviour through Laravel's `$this->validate($request, $rules)`:

```ts
import { Controller } from '@/Routing/Controller';

@Injectable()
class SignupController extends Controller {
  async store(request: Request) {
    const data = await this.validate(request, {
      name: 'required|string|min:2',
      'users.*.email': 'required|email',
    });

    return { signed: data };
  }
}
```

## Auth Validation

These rules resolve through the container, so they need the
`AuthServiceProvider` (and, for `current_password`, the
`HashServiceProvider`) registered:

- current_password
  - Compares the value against the authenticated user's stored password
    via `Auth::guard($guard)->user()` and the `hash` service.
  - Use as a string rule or the builder:
    ```ts
    const rules = {
      current_password: 'required|current_password', // or 'current_password:api'
      password: [Rule.currentPassword()],
    };
    ```
  - A guest or a mismatch fails with
    `The :attribute does not match the current password.`

- password
  - The string `password` rule applies Laravel's `Password::defaults()`
    (min 8). `Rule.password()` is fluent and opt-in:
    ```ts
    const rules = {
      password: [
        Rule.required(),
        Rule.password().min(12).letters().mixedCase().numbers().symbols().uncompromised(),
      ],
    };
    ```
  - `uncompromised()` is a local/no-network check against a bundled list
    of frequently leaked passwords - swap in your own corpus if you need
    breach-API parity.

- can
  - `Rule.can('update', post)` and the string form
    `'can:update-post,post_id'` (ability, field names whose values become
    ability arguments) both validate through the shared Gate; a denial
    surfaces the gate's message on the field:
    ```ts
    const rules = { post_id: ['required', Rule.can('update', post)] };
    ```

## Error Handling

- `validate()` returns `true/false`
- `errors()` returns a map of field → error messages
- Throw `ValidationException` or handle manually depending on your flow

## Tips

- Chain rules in arrays to compose complex constraints
- Prefer field comparisons (gt/gte/lt/lte) for relational checks
- Use conditional presence for dynamic forms
- Keep messages clear and domain-specific for better UX
