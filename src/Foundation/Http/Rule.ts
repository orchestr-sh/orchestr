import type { ValidationRuleObject } from './Validator';
type RuleReturn = ValidationRuleObject | string;
import {
  EmailRule,
  NumericRule,
  InRule,
  NotInRule,
  ArrayRule,
  ProhibitedIfRule,
  RequiredIfRule,
  ExcludeIfRule,
  DateRule,
  AnyOfRule,
  ContainsRule,
  DoesntContainRule,
  EnumRule,
  ImageFileRule,
  DimensionsRule,
  ExistsRule,
  UniqueRule,
  DatabaseRule,
  CanRule,
  PasswordRule,
} from './Rules';

export class Rule {
  static required(): RuleReturn {
    return 'required';
  }
  static string(): RuleReturn {
    return 'string';
  }
  static email(): RuleReturn {
    return new EmailRule();
  }
  static numeric(): RuleReturn {
    return new NumericRule();
  }
  static integer(): RuleReturn {
    return 'integer';
  }
  static boolean(): RuleReturn {
    return 'boolean';
  }
  static min(n: number): RuleReturn {
    return `min:${n}`;
  }
  static max(n: number): RuleReturn {
    return `max:${n}`;
  }
  static between(min: number, max: number): RuleReturn {
    return `between:${min},${max}`;
  }
  static size(n: number): RuleReturn {
    return `size:${n}`;
  }
  static in(values: Array<string | number>): RuleReturn {
    return new InRule(values);
  }
  static notIn(values: Array<string | number>): RuleReturn {
    return new NotInRule(values);
  }
  static array(): RuleReturn {
    return new ArrayRule();
  }
  static distinct(): RuleReturn {
    return 'distinct';
  }
  static confirmed(): RuleReturn {
    return 'confirmed';
  }
  static url(): RuleReturn {
    return 'url';
  }
  static uuid(): RuleReturn {
    return 'uuid';
  }
  static timezone(): RuleReturn {
    return 'timezone';
  }
  static alpha(): RuleReturn {
    return 'alpha';
  }
  static alphaNum(): RuleReturn {
    return 'alpha_num';
  }
  static alphaDash(): RuleReturn {
    return 'alpha_dash';
  }
  static regex(pattern: string | RegExp): RuleReturn {
    const p = typeof pattern === 'string' ? pattern : pattern.source;
    return `regex:${p}`;
  }
  static notRegex(pattern: string | RegExp): RuleReturn {
    const p = typeof pattern === 'string' ? pattern : pattern.source;
    return `not_regex:${p}`;
  }
  static nullable(): RuleReturn {
    return 'nullable';
  }
  static sometimes(): RuleReturn {
    return 'sometimes';
  }
  static accepted(): RuleReturn {
    return 'accepted';
  }
  static acceptedIf(field: string, value: string | number | boolean): RuleReturn {
    return `accepted_if:${field},${value}`;
  }
  static declined(): RuleReturn {
    return 'declined';
  }
  static declinedIf(field: string, value: string | number | boolean): RuleReturn {
    return `declined_if:${field},${value}`;
  }
  static present(): RuleReturn {
    return 'present';
  }
  static filled(): RuleReturn {
    return 'filled';
  }
  static json(): RuleReturn {
    return 'json';
  }
  static ascii(): RuleReturn {
    return 'ascii';
  }
  static decimal(places?: number): RuleReturn {
    return places === undefined ? 'decimal' : `decimal:${places}`;
  }
  static startsWith(values: Array<string>): RuleReturn {
    return `starts_with:${values.join(',')}`;
  }
  static endsWith(values: Array<string>): RuleReturn {
    return `ends_with:${values.join(',')}`;
  }
  static same(field: string): RuleReturn {
    return `same:${field}`;
  }
  static different(field: string): RuleReturn {
    return `different:${field}`;
  }
  static gt(fieldOrValue: string | number): RuleReturn {
    return `gt:${fieldOrValue}`;
  }
  static gte(fieldOrValue: string | number): RuleReturn {
    return `gte:${fieldOrValue}`;
  }
  static lt(fieldOrValue: string | number): RuleReturn {
    return `lt:${fieldOrValue}`;
  }
  static lte(fieldOrValue: string | number): RuleReturn {
    return `lte:${fieldOrValue}`;
  }
  static ip(): RuleReturn {
    return 'ip';
  }
  static ipv4(): RuleReturn {
    return 'ipv4';
  }
  static ipv6(): RuleReturn {
    return 'ipv6';
  }
  static macAddress(): RuleReturn {
    return 'mac_address';
  }
  static lowercase(): RuleReturn {
    return 'lowercase';
  }
  static uppercase(): RuleReturn {
    return 'uppercase';
  }
  static inArray(field: string): RuleReturn {
    return `in_array:${field}`;
  }
  static prohibited(): RuleReturn {
    return 'prohibited';
  }
  static prohibitedIf(field: string, value: string | number | boolean): RuleReturn {
    return new ProhibitedIfRule(field, value);
  }
  static prohibitedUnless(field: string, value: string | number | boolean): RuleReturn {
    return `prohibited_unless:${field},${value}`;
  }
  static prohibits(...fields: string[]): RuleReturn {
    return `prohibits:${fields.join(',')}`;
  }
  static file(): RuleReturn {
    return 'file';
  }
  static image(): RuleReturn {
    return 'image';
  }
  static mimetypes(types: string[]): RuleReturn {
    return `mimetypes:${types.join(',')}`;
  }
  static mimes(extensions: string[]): RuleReturn {
    return `mimes:${extensions.join(',')}`;
  }
  static activeUrl(): RuleReturn {
    return 'active_url';
  }
  static exclude(): RuleReturn {
    return 'exclude';
  }
  static excludeIf(field: string, value: string | number | boolean): RuleReturn {
    return new ExcludeIfRule(field, value);
  }
  static excludeUnless(field: string, value: string | number | boolean): RuleReturn {
    return `exclude_unless:${field},${value}`;
  }
  static anyOf(rules: Array<string | ValidationRuleObject>): RuleReturn {
    return new AnyOfRule(rules);
  }
  static contains(needle: string): RuleReturn {
    return new ContainsRule(needle);
  }
  static doesntContain(needle: string): RuleReturn {
    return new DoesntContainRule(needle);
  }
  static enum(values: Array<string | number | boolean>): RuleReturn {
    return new EnumRule(values);
  }
  static imageFile(): RuleReturn {
    return new ImageFileRule();
  }
  static dimensions(opts: {
    width?: number;
    height?: number;
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
  }): RuleReturn {
    return new DimensionsRule(opts);
  }
  static exists(table: string, column?: string): RuleReturn {
    return new ExistsRule(table, column);
  }
  static unique(table: string, column?: string): RuleReturn {
    return new UniqueRule(table, column);
  }
  static databaseRule(rule: string): RuleReturn {
    return new DatabaseRule(rule);
  }
  static can(ability: string): RuleReturn {
    return new CanRule(ability);
  }
  static password(): RuleReturn {
    return new PasswordRule();
  }
  static requiredIf(field: string, value: string | number | boolean): RuleReturn {
    return new RequiredIfRule(field, value);
  }
  static requiredUnless(field: string, value: string | number | boolean): RuleReturn {
    return `required_unless:${field},${value}`;
  }
  static requiredWith(...fields: string[]): RuleReturn {
    return `required_with:${fields.join(',')}`;
  }
  static requiredWithAll(...fields: string[]): RuleReturn {
    return `required_with_all:${fields.join(',')}`;
  }
  static requiredWithout(...fields: string[]): RuleReturn {
    return `required_without:${fields.join(',')}`;
  }
  static requiredWithoutAll(...fields: string[]): RuleReturn {
    return `required_without_all:${fields.join(',')}`;
  }
  static date(): RuleReturn {
    return new DateRule();
  }
  static dateEquals(date: string): RuleReturn {
    return `date_equals:${date}`;
  }
  static after(dateOrField: string): RuleReturn {
    return `after:${dateOrField}`;
  }
  static afterOrEqual(dateOrField: string): RuleReturn {
    return `after_or_equal:${dateOrField}`;
  }
  static before(dateOrField: string): RuleReturn {
    return `before:${dateOrField}`;
  }
  static beforeOrEqual(dateOrField: string): RuleReturn {
    return `before_or_equal:${dateOrField}`;
  }
  static digits(length: number): RuleReturn {
    return `digits:${length}`;
  }
  static digitsBetween(min: number, max: number): RuleReturn {
    return `digits_between:${min},${max}`;
  }
  static minDigits(n: number): RuleReturn {
    return `min_digits:${n}`;
  }
  static maxDigits(n: number): RuleReturn {
    return `max_digits:${n}`;
  }
  static multipleOf(n: number): RuleReturn {
    return `multiple_of:${n}`;
  }
}
