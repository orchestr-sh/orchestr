import type { ValidationRuleObject } from './Validator';
import {
  RequiredRule,
  StringRule,
  EmailRule,
  NumericRule,
  IntegerRule,
  BooleanRule,
  MinRule,
  MaxRule,
  BetweenRule,
  SizeRule,
  InRule,
  NotInRule,
  ArrayRule,
  DistinctRule,
  ConfirmedRule,
  UrlRule,
  UuidRule,
  TimezoneRule,
  AlphaRule,
  AlphaNumRule,
  AlphaDashRule,
  RegexRule,
  NotRegexRule,
  NullableRule,
  SometimesRule,
  JsonRule,
  AsciiRule,
  DecimalRule,
  StartsWithRule,
  EndsWithRule,
  SameRule,
  DifferentRule,
  GtRule,
  GteRule,
  LtRule,
  LteRule,
  IpRule,
  Ipv4Rule,
  Ipv6Rule,
  MacAddressRule,
  LowercaseRule,
  UppercaseRule,
  InArrayRule,
  PresentRule,
  FilledRule,
  AcceptedRule,
  AcceptedIfRule,
  DeclinedRule,
  DeclinedIfRule,
  ProhibitedRule,
  ProhibitedIfRule,
  ProhibitedUnlessRule,
  ProhibitsRule,
  FileRule,
  ImageRule,
  MimetypesRule,
  MimesRule,
  ActiveUrlRule,
  RequiredIfRule,
  RequiredUnlessRule,
  RequiredWithRule,
  RequiredWithAllRule,
  RequiredWithoutRule,
  RequiredWithoutAllRule,
  ExcludeRule,
  ExcludeIfRule,
  ExcludeUnlessRule,
  DateRule,
  DateEqualsRule,
  AfterRule,
  AfterOrEqualRule,
  BeforeRule,
  BeforeOrEqualRule,
  DigitsRule,
  DigitsBetweenRule,
  MinDigitsRule,
  MaxDigitsRule,
  MultipleOfRule,
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
  static required(): ValidationRuleObject {
    return new RequiredRule();
  }
  static string(): ValidationRuleObject {
    return new StringRule();
  }
  static email(): ValidationRuleObject {
    return new EmailRule();
  }
  static numeric(): ValidationRuleObject {
    return new NumericRule();
  }
  static integer(): ValidationRuleObject {
    return new IntegerRule();
  }
  static boolean(): ValidationRuleObject {
    return new BooleanRule();
  }
  static min(n: number): ValidationRuleObject {
    return new MinRule(n);
  }
  static max(n: number): ValidationRuleObject {
    return new MaxRule(n);
  }
  static between(min: number, max: number): ValidationRuleObject {
    return new BetweenRule(min, max);
  }
  static size(n: number): ValidationRuleObject {
    return new SizeRule(n);
  }
  static in(values: Array<string | number>): ValidationRuleObject {
    return new InRule(values);
  }
  static notIn(values: Array<string | number>): ValidationRuleObject {
    return new NotInRule(values);
  }
  static array(): ValidationRuleObject {
    return new ArrayRule();
  }
  static distinct(): ValidationRuleObject {
    return new DistinctRule();
  }
  static confirmed(): ValidationRuleObject {
    return new ConfirmedRule();
  }
  static url(): ValidationRuleObject {
    return new UrlRule();
  }
  static uuid(): ValidationRuleObject {
    return new UuidRule();
  }
  static timezone(): ValidationRuleObject {
    return new TimezoneRule();
  }
  static alpha(): ValidationRuleObject {
    return new AlphaRule();
  }
  static alphaNum(): ValidationRuleObject {
    return new AlphaNumRule();
  }
  static alphaDash(): ValidationRuleObject {
    return new AlphaDashRule();
  }
  static regex(pattern: string | RegExp): ValidationRuleObject {
    return new RegexRule(pattern);
  }
  static notRegex(pattern: string | RegExp): ValidationRuleObject {
    return new NotRegexRule(pattern);
  }
  static nullable(): ValidationRuleObject {
    return new NullableRule();
  }
  static sometimes(): ValidationRuleObject {
    return new SometimesRule();
  }
  static accepted(): ValidationRuleObject {
    return new AcceptedRule();
  }
  static acceptedIf(field: string, value: string | number | boolean): ValidationRuleObject {
    return new AcceptedIfRule(field, value);
  }
  static declined(): ValidationRuleObject {
    return new DeclinedRule();
  }
  static declinedIf(field: string, value: string | number | boolean): ValidationRuleObject {
    return new DeclinedIfRule(field, value);
  }
  static present(): ValidationRuleObject {
    return new PresentRule();
  }
  static filled(): ValidationRuleObject {
    return new FilledRule();
  }
  static json(): ValidationRuleObject {
    return new JsonRule();
  }
  static ascii(): ValidationRuleObject {
    return new AsciiRule();
  }
  static decimal(places?: number): ValidationRuleObject {
    return new DecimalRule(places);
  }
  static startsWith(values: Array<string>): ValidationRuleObject {
    return new StartsWithRule(values);
  }
  static endsWith(values: Array<string>): ValidationRuleObject {
    return new EndsWithRule(values);
  }
  static same(field: string): ValidationRuleObject {
    return new SameRule(field);
  }
  static different(field: string): ValidationRuleObject {
    return new DifferentRule(field);
  }
  static gt(fieldOrValue: string | number): ValidationRuleObject {
    return new GtRule(fieldOrValue);
  }
  static gte(fieldOrValue: string | number): ValidationRuleObject {
    return new GteRule(fieldOrValue);
  }
  static lt(fieldOrValue: string | number): ValidationRuleObject {
    return new LtRule(fieldOrValue);
  }
  static lte(fieldOrValue: string | number): ValidationRuleObject {
    return new LteRule(fieldOrValue);
  }
  static ip(): ValidationRuleObject {
    return new IpRule();
  }
  static ipv4(): ValidationRuleObject {
    return new Ipv4Rule();
  }
  static ipv6(): ValidationRuleObject {
    return new Ipv6Rule();
  }
  static macAddress(): ValidationRuleObject {
    return new MacAddressRule();
  }
  static lowercase(): ValidationRuleObject {
    return new LowercaseRule();
  }
  static uppercase(): ValidationRuleObject {
    return new UppercaseRule();
  }
  static inArray(field: string): ValidationRuleObject {
    return new InArrayRule(field);
  }
  static prohibited(): ValidationRuleObject {
    return new ProhibitedRule();
  }
  static prohibitedIf(field: string, value: string | number | boolean): ValidationRuleObject {
    return new ProhibitedIfRule(field, value);
  }
  static prohibitedUnless(field: string, value: string | number | boolean): ValidationRuleObject {
    return new ProhibitedUnlessRule(field, value);
  }
  static prohibits(...fields: string[]): ValidationRuleObject {
    return new ProhibitsRule(fields);
  }
  static file(): ValidationRuleObject {
    return new FileRule();
  }
  static image(): ValidationRuleObject {
    return new ImageRule();
  }
  static mimetypes(types: string[]): ValidationRuleObject {
    return new MimetypesRule(types);
  }
  static mimes(extensions: string[]): ValidationRuleObject {
    return new MimesRule(extensions);
  }
  static activeUrl(): ValidationRuleObject {
    return new ActiveUrlRule();
  }
  static exclude(): ValidationRuleObject {
    return new ExcludeRule();
  }
  static excludeIf(field: string, value: string | number | boolean): ValidationRuleObject {
    return new ExcludeIfRule(field, value);
  }
  static excludeUnless(field: string, value: string | number | boolean): ValidationRuleObject {
    return new ExcludeUnlessRule(field, value);
  }
  static anyOf(rules: Array<string | ValidationRuleObject>): ValidationRuleObject {
    return new AnyOfRule(rules);
  }
  static contains(needle: string): ValidationRuleObject {
    return new ContainsRule(needle);
  }
  static doesntContain(needle: string): ValidationRuleObject {
    return new DoesntContainRule(needle);
  }
  static enum(values: Array<string | number | boolean>): ValidationRuleObject {
    return new EnumRule(values);
  }
  static imageFile(): ValidationRuleObject {
    return new ImageFileRule();
  }
  static dimensions(opts: {
    width?: number;
    height?: number;
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
  }): ValidationRuleObject {
    return new DimensionsRule(opts);
  }
  static exists(table: string, column?: string): ValidationRuleObject {
    return new ExistsRule(table, column);
  }
  static unique(table: string, column?: string): ValidationRuleObject {
    return new UniqueRule(table, column);
  }
  static databaseRule(rule: string): ValidationRuleObject {
    return new DatabaseRule(rule);
  }
  static can(ability: string): ValidationRuleObject {
    return new CanRule(ability);
  }
  static password(): ValidationRuleObject {
    return new PasswordRule();
  }
  static requiredIf(field: string, value: string | number | boolean): ValidationRuleObject {
    return new RequiredIfRule(field, value);
  }
  static requiredUnless(field: string, value: string | number | boolean): ValidationRuleObject {
    return new RequiredUnlessRule(field, value);
  }
  static requiredWith(...fields: string[]): ValidationRuleObject {
    return new RequiredWithRule(...fields);
  }
  static requiredWithAll(...fields: string[]): ValidationRuleObject {
    return new RequiredWithAllRule(...fields);
  }
  static requiredWithout(...fields: string[]): ValidationRuleObject {
    return new RequiredWithoutRule(...fields);
  }
  static requiredWithoutAll(...fields: string[]): ValidationRuleObject {
    return new RequiredWithoutAllRule(...fields);
  }
  static date(): ValidationRuleObject {
    return new DateRule();
  }
  static dateEquals(date: string): ValidationRuleObject {
    return new DateEqualsRule(date);
  }
  static after(dateOrField: string): ValidationRuleObject {
    return new AfterRule(dateOrField);
  }
  static afterOrEqual(dateOrField: string): ValidationRuleObject {
    return new AfterOrEqualRule(dateOrField);
  }
  static before(dateOrField: string): ValidationRuleObject {
    return new BeforeRule(dateOrField);
  }
  static beforeOrEqual(dateOrField: string): ValidationRuleObject {
    return new BeforeOrEqualRule(dateOrField);
  }
  static digits(length: number): ValidationRuleObject {
    return new DigitsRule(length);
  }
  static digitsBetween(min: number, max: number): ValidationRuleObject {
    return new DigitsBetweenRule(min, max);
  }
  static minDigits(n: number): ValidationRuleObject {
    return new MinDigitsRule(n);
  }
  static maxDigits(n: number): ValidationRuleObject {
    return new MaxDigitsRule(n);
  }
  static multipleOf(n: number): ValidationRuleObject {
    return new MultipleOfRule(n);
  }
}
