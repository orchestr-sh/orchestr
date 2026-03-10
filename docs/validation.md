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
- Arrays: `array()`, `distinct()`, `in([...])`, `notIn([...])`, `inArray(field)`
- Dates: `date()`, `dateEquals(date)`, `after(dateOrField)`, `afterOrEqual(...)`, `before(...)`, `beforeOrEqual(...)`
- Network: `url()`, `activeUrl()`, `ip()`, `ipv4()`, `ipv6()`, `macAddress()`, `uuid()`, `timezone()`
- Files: `file()`, `image()`, `mimetypes([...])`, `mimes([...])`
- Conditionals: `accepted()`, `acceptedIf(field,val)`, `declined()`, `declinedIf(field,val)`

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

```ts
const rules = {
  avatar: [Rule.file(), Rule.image(), Rule.mimes(['png','jpg'])],
  doc: [Rule.file(), Rule.mimetypes(['application/pdf'])],
};
```

## Custom Messages

Pass per-field messages via the Validator:

```ts
const messages = {
  'email.required': 'Email is required',
  'email.email': 'Email must be valid',
};
const v = new Validator(data, rules, messages);
```

Rule classes may also provide tailored messages when they are invokable; otherwise messages fall back to defaults.

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

## Error Handling

- `validate()` returns `true/false`
- `errors()` returns a map of field → error messages
- Throw `ValidationException` or handle manually depending on your flow

## Tips

- Chain rules in arrays to compose complex constraints
- Prefer field comparisons (gt/gte/lt/lte) for relational checks
- Use conditional presence for dynamic forms
- Keep messages clear and domain-specific for better UX
