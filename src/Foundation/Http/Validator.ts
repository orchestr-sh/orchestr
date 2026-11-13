/**
 * Validator - Laravel's validation engine
 * Illuminate\Validation\Validator
 *
 * Provides validation rules and error handling. Rule evaluation itself
 * lives in the shared rule registry (`Rules/Registry`), so the loop here
 * stays rule-agnostic: string rules, `Rule` object string forms and
 * `Validator.extend` extensions all resolve through the same map (DRY),
 * and new rules plug in without editing this class (OCP). Beyond running
 * rules it covers Laravel's nested/array validation (`users.*.email`
 * wildcards expanded to concrete error keys), `bail` /
 * `stopOnFirstFailure`, `sometimes` and `nullable` semantics, `after()`
 * hooks and custom message/attribute resolution.
 */

import type { MessageReplacer, RuleContext, RuleDefinition, RuleExtension } from './Rules/Registry';
import { defaultRegistry } from './Rules/Registry';

export type ValidationRule = string | Array<string | ValidationRuleObject> | ValidationRuleObject;
export type ValidationRules = Record<string, ValidationRule>;

export interface ValidationRuleObject {
  rule: string;
  message?: string;
  [key: string]: any;
}

/**
 * A hook registered with `after()`; it receives the running validator and
 * may add errors through `addError` before validation completes.
 * Laravel: $validator->after(fn ($validator) => ...)
 */
export type AfterHook = (validator: Validator) => void | Promise<void>;

/**
 * One normalized rule item of an attribute's rule list
 */
interface ParsedRuleItem {
  /** Rule name before the first colon */
  name: string;
  /** Parameters after the name (colon split) */
  params: string[];
  /** Custom message from a `{ rule, message }` object */
  customMessage?: string;
  /** Invokable Rule object (Rule.email(), Rule.can(), custom objects...) */
  invokable?: ValidationRuleObject & { passes: (...args: any[]) => any; messageFor?: (...args: any[]) => any };
}

/**
 * A concrete attribute to validate: the rule pattern with every `*`
 * replaced by the key found in the data, plus the bindings collected for
 * wildcard-dependent parameters
 */
interface FieldEntry {
  field: string;
  pattern: string;
  bindings: string[];
}

export class Validator {
  private data: Record<string, any>;
  private rules: ValidationRules;
  private customMessages: Record<string, string>;
  private customAttributes: Record<string, string>;
  private errorMessages: Record<string, string[]> = {};
  private validatedFields: Record<string, any> = {};

  /** stopOnFirstFailure flag: abort as soon as any rule fails */
  private stopsOnFirstFailure: boolean = false;

  /** Hooks registered with after(), run once every attribute has validated */
  private afterHooks: AfterHook[] = [];

  constructor(
    data: Record<string, any>,
    rules: ValidationRules,
    customMessages: Record<string, string> = {},
    customAttributes: Record<string, string> = {}
  ) {
    this.data = data;
    this.rules = rules;
    this.customMessages = customMessages;
    this.customAttributes = customAttributes;
  }

  // ---------------------------------------------------------------------
  // Static API
  // ---------------------------------------------------------------------

  /**
   * Build a validator without `new`
   * Laravel: Validator::make()
   */
  static make(
    data: Record<string, any>,
    rules: ValidationRules,
    customMessages: Record<string, string> = {},
    customAttributes: Record<string, string> = {}
  ): Validator {
    return new Validator(data, rules, customMessages, customAttributes);
  }

  /**
   * Register a custom rule the Validator can run from string rules
   * (Laravel: Validator::extend). The callback receives
   * `(attribute, value, parameters, validator)`; returning false fails the
   * attribute with the provided message or the resolved default. Custom
   * rules skip attributes whose value is missing unless registered with
   * extendImplicit.
   */
  static extend(rule: string, callback: RuleExtension, message?: string): void {
    defaultRegistry.extend(rule, callback, { implicit: false, message });
  }

  /**
   * Like extend() but the rule also runs when the attribute is missing or
   * empty
   * Laravel: Validator::extendImplicit()
   */
  static extendImplicit(rule: string, callback: RuleExtension, message?: string): void {
    defaultRegistry.extend(rule, callback, { implicit: true, message });
  }

  /**
   * Remove a rule registered through extend()/extendImplicit()
   * Laravel: Validator::forgetExtension()
   */
  static forgetExtension(rule: string): void {
    defaultRegistry.forget(rule);
  }

  /**
   * Determine whether a rule name resolves in the shared registry
   */
  static hasRule(rule: string): boolean {
    return defaultRegistry.has(rule);
  }

  /**
   * Register a message replacer consulted with every resolved validation
   * message, e.g. to swap placeholders
   * Laravel: Validator::replacer()
   */
  static replacer(callback: MessageReplacer): void {
    defaultRegistry.replacer(callback);
  }

  // ---------------------------------------------------------------------
  // Fluent configuration
  // ---------------------------------------------------------------------

  /**
   * Stop validating the moment the first rule on any attribute fails
   * Laravel: $validator->stopOnFirstFailure()
   */
  stopOnFirstFailure(stop: boolean = true): this {
    this.stopsOnFirstFailure = stop;
    return this;
  }

  /**
   * Register a hook that runs after all attributes have been validated
   * and may add further errors via `addError`
   * Laravel: $validator->after(fn ($validator) => $validator->errors()->add(...))
   */
  after(callback: AfterHook): this {
    this.afterHooks.push(callback);
    return this;
  }

  // ---------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------

  /**
   * Validate the data against the rules
   *
   * @returns {Promise<boolean>} True if validation passes
   */
  async validate(): Promise<boolean> {
    this.errorMessages = {};
    this.validatedFields = {};

    for (const entry of this.expandFields()) {
      await this.validateField(entry);

      if (this.stopsOnFirstFailure && this.fails()) {
        break;
      }
    }

    // After hooks always get their turn, mirroring Laravel's
    // callAfterValidationHooks: they can add errors even after a bail
    for (const hook of this.afterHooks) {
      await hook(this);
    }

    return Object.keys(this.errorMessages).length === 0;
  }

  /**
   * Run every rule item of one (possibly wildcard-expanded) attribute
   */
  private async validateField(entry: FieldEntry): Promise<void> {
    const items = this.normalizeItems(entry.pattern);
    const names = items.map((item) => item.name);
    const value = this.getFieldValue(entry.field);

    const hasSometimes = names.includes('sometimes');
    const hasNullable = names.includes('nullable');
    const bail = names.includes('bail');

    // `sometimes` skips the attribute entirely while it is missing from
    // the data - including for wildcard-expanded nested paths
    if (hasSometimes && !this.hasValue(entry.field)) {
      return;
    }

    // `nullable` short-circuits everything except `required` while the
    // value is null/undefined, like the previous engine did
    const onlyRequired = hasNullable && (value === undefined || value === null);

    let excluded = false;

    for (const item of items) {
      if (excluded) {
        break;
      }

      if (onlyRequired && !(item.name === 'required' && !item.invokable)) {
        continue;
      }

      if (item.invokable) {
        const failed = await this.runInvokable(item.invokable, entry, value);

        if (failed) {
          if (bail || this.stopsOnFirstFailure) {
            break;
          }
        }

        continue;
      }

      const definition = defaultRegistry.resolve(item.name);

      if (!definition) {
        if (item.name) {
          console.warn(`Unknown validation rule: ${item.name}`);
        }
        continue;
      }

      // Custom (extended, non-implicit) rules skip missing values, the
      // same way Laravel's isValidatable does
      if (definition.extension && !definition.implicit && value === undefined) {
        continue;
      }

      const ctx = this.ruleContext(entry, item, definition);
      const result = await definition.passes(ctx);

      if (definition.exclude) {
        if (result === true) {
          excluded = true;
          break;
        }

        continue;
      }

      if (result !== true) {
        // Inline rule messages (like Laravel's ->message()) win over the
        // message the implementation resolved
        const message =
          item.customMessage ??
          (typeof result === 'string' && result !== ''
            ? result
            : this.getMessage(
                entry.field,
                item.name,
                `The ${this.getAttribute(entry.field, entry.pattern)} is invalid.`,
                entry.pattern
              ));

        this.addError(entry.field, message);

        if (bail || this.stopsOnFirstFailure) {
          break;
        }
      }
    }

    // If no errors for this field, add to validated data (excluded fields
    // never make it into validated(), like Laravel)
    if (!excluded && !this.errorMessages[entry.field]) {
      this.setValidated(entry.field, value);
    }
  }

  /**
   * Run an invokable Rule object and report whether it failed
   */
  private async runInvokable(
    invokable: NonNullable<ParsedRuleItem['invokable']>,
    entry: FieldEntry,
    value: any
  ): Promise<boolean> {
    const attribute = this.getAttribute(entry.field, entry.pattern);
    const bind = (name: string) => this.bindWildcards(name, entry.bindings);
    const ctx = {
      field: entry.field,
      attribute,
      other: (name: string) => this.getFieldValue(bind(name)),
      helpers: {
        isPresent: (v: any) => v !== undefined,
        isEmpty: (v: any) => v === undefined || v === null || v === '',
        toNumber: (v: any) => (typeof v === 'number' ? v : parseFloat(String(v))),
        toString: (v: any) => (typeof v === 'string' ? v : String(v)),
        isDate: (v: any) => {
          const d = new Date(v);
          return !isNaN(d.getTime());
        },
      },
    };
    const passes = await invokable.passes(attribute, value, ctx);

    if (passes) {
      return false;
    }

    const custom =
      typeof invokable.messageFor === 'function'
        ? invokable.messageFor(attribute, value, ctx)
        : typeof invokable.message === 'function'
          ? (invokable.message as unknown as (...args: any[]) => string)(attribute, value, ctx)
          : invokable.message;
    const msg = custom || this.getMessage(entry.field, invokable.rule, `The ${attribute} is invalid.`, entry.pattern);

    this.addError(entry.field, msg);

    return true;
  }

  /**
   * Build the context a registry rule sees for one attribute/item pair:
   * parameters with wildcards bound, sibling lookups, message helpers
   */
  private ruleContext(entry: FieldEntry, item: ParsedRuleItem, definition: RuleDefinition): RuleContext {
    const bind = (value: string) => this.bindWildcards(value, entry.bindings);
    // Conditional rules reference other fields in their parameters; bind
    // `*` in those parameters to this attribute's wildcard index so
    // `users.*.license => exclude_if:users.*.type,x` works per item
    const params = definition.fieldParams && entry.bindings.length ? item.params.map(bind) : item.params;
    const list = params.length
      ? params
          .join(':')
          .split(/[,:]/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
      : [];

    return {
      field: entry.field,
      pattern: entry.pattern,
      attribute: this.getAttribute(entry.field, entry.pattern),
      rule: item.name,
      value: this.getFieldValue(entry.field),
      params,
      list,
      data: this.data,
      other: (name: string) => this.getFieldValue(bind(name)),
      has: (name: string) => this.hasValue(bind(name)),
      validator: this,
      getMessage: (rule: string, fallback: string) => this.getMessage(entry.field, rule, fallback, entry.pattern),
      fail: (fallback: string) => this.getMessage(entry.field, item.name, fallback, entry.pattern),
    };
  }

  /**
   * Normalize one attribute's rule value into parsed items: pipe strings,
   * arrays of strings/objects and single objects all collapse into the
   * same item shape the loop runs
   */
  private normalizeItems(pattern: string): ParsedRuleItem[] {
    const rule = this.rules[pattern];
    const rawItems: Array<string | ValidationRuleObject> =
      typeof rule === 'string'
        ? rule.split('|').map((r) => r.trim())
        : Array.isArray(rule)
          ? rule
          : rule && typeof rule === 'object'
            ? [rule as ValidationRuleObject]
            : [];

    return rawItems
      .filter((item) => item !== undefined && item !== null && item !== '')
      .map((item) => this.parseItem(item));
  }

  /**
   * Split one rule item into its name, colon parameters and (for object
   * items) its invokable rule or custom message
   */
  private parseItem(item: string | ValidationRuleObject): ParsedRuleItem {
    if (typeof item === 'string') {
      const [name, ...params] = item.split(':');

      return { name, params };
    }

    if (item.invokable === true && typeof (item as any).passes === 'function') {
      const [name] = String(item.rule ?? '').split(':');

      return { name, params: [], invokable: item as ParsedRuleItem['invokable'] };
    }

    const [name, ...params] = String(item.rule ?? '').split(':');

    return { name, params, customMessage: typeof item.message === 'string' ? item.message : undefined };
  }

  // ---------------------------------------------------------------------
  // Nested / wildcard attribute expansion
  // ---------------------------------------------------------------------

  /**
   * Turn the rule patterns into concrete attributes to validate,
   * expanding every `*` against the data: `users.*.email` becomes
   * `users.0.email`, `users.1.email`, ... so errors report concrete keys
   * while messages and custom attributes still resolve from the pattern.
   */
  private expandFields(): FieldEntry[] {
    const entries: FieldEntry[] = [];

    for (const pattern of Object.keys(this.rules)) {
      if (!pattern.includes('*')) {
        entries.push({ field: pattern, pattern, bindings: [] });
        continue;
      }

      entries.push(...this.resolveWildcards(pattern));
    }

    return entries;
  }

  /**
   * Walk one wildcard pattern through the data, collecting the key that
   * replaced each `*` so dependent-field parameters can be bound to the
   * same item
   */
  private resolveWildcards(pattern: string): FieldEntry[] {
    const segments = pattern.split('.');
    const results: FieldEntry[] = [];

    const walk = (index: number, node: any, parts: string[], bindings: string[]): void => {
      if (index === segments.length) {
        results.push({ field: parts.join('.'), pattern, bindings });
        return;
      }

      const segment = segments[index];
      const isNode = node !== undefined && node !== null && typeof node === 'object';

      if (segment === '*') {
        // Iterables only: a missing or scalar parent contributes no
        // attributes (declare `array`/`required` on the parent to flag it)
        const keys = isNode ? (Array.isArray(node) ? node.map((_, i) => String(i)) : Object.keys(node)) : [];

        for (const key of keys) {
          walk(index + 1, node[key], [...parts, key], [...bindings, key]);
        }

        return;
      }

      // Literal segments keep walking even when the key is missing, so
      // `required` fires for `users.0.email` on an item without one
      walk(index + 1, isNode ? node[segment] : undefined, [...parts, segment], bindings);
    };

    walk(0, this.data, [], []);

    return results;
  }

  /**
   * Replace each `*` in a dependent-field parameter with the matching
   * wildcard binding (positional, like Laravel's `users.*.type` inside
   * `users.*.license => required_if:users.*.type,pro`)
   */
  private bindWildcards(value: string, bindings: string[]): string {
    if (!bindings.length || !value.includes('*')) {
      return value;
    }

    let index = 0;

    return value.replace(/\*/g, () => bindings[index++] ?? '*');
  }

  // ---------------------------------------------------------------------
  // Data access
  // ---------------------------------------------------------------------

  /**
   * Get field value from data, supporting dot notation
   */
  private getFieldValue(field: string): any {
    const keys = field.split('.');
    let value: any = this.data;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Determine whether the data carries a dot-notation path (the key may
   * exist with an undefined value, matching Laravel's presence check)
   */
  private hasValue(field: string): boolean {
    const keys = field.split('.');
    let node: any = this.data;

    for (const key of keys) {
      if (node === undefined || node === null || typeof node !== 'object' || !(key in node)) {
        return false;
      }

      node = node[key];
    }

    return true;
  }

  /**
   * Store one validated attribute into the validated data, building the
   * nested array/object structure a wildcard path implies
   * (users.0.email => validated().users[0].email)
   */
  private setValidated(path: string, value: any): void {
    const keys = path.split('.');
    let cursor: any = this.validatedFields;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];

      if (cursor[key] === undefined || cursor[key] === null || typeof cursor[key] !== 'object') {
        cursor[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      }

      cursor = cursor[key];
    }

    cursor[keys[keys.length - 1]] = value;
  }

  // ---------------------------------------------------------------------
  // Messages and attributes
  // ---------------------------------------------------------------------

  /**
   * Get custom message or default message. Wildcard-expanded attributes
   * look up their concrete key first, then the pattern key, so
   * `users.*.email.required` covers every item. `:attribute` placeholders
   * are filled in and the registered replacer gets the final say.
   */
  private getMessage(field: string, rule: string, defaultMessage: string, pattern?: string): string {
    const customKey = `${field}.${rule}`;
    const patternKey = pattern ? `${pattern}.${rule}` : '';
    const attribute = this.getAttribute(field, pattern);

    let message =
      this.customMessages[customKey] ||
      (patternKey && this.customMessages[patternKey]) ||
      this.customMessages[rule] ||
      defaultMessage;

    message = message.replaceAll(':attribute', attribute);

    return defaultRegistry.applyReplacer(message, attribute, field, rule, []);
  }

  /**
   * Get custom attribute name or use field name; wildcard attributes fall
   * back to the pattern's custom name
   */
  private getAttribute(field: string, pattern?: string): string {
    return (
      this.customAttributes[field] || (pattern ? this.customAttributes[pattern] : undefined) || field.replace(/_/g, ' ')
    );
  }

  // ---------------------------------------------------------------------
  // Errors and results
  // ---------------------------------------------------------------------

  /**
   * Add an error message for a field. Public so `after()` hooks can
   * report cross-field problems, like Laravel's
   * `$validator->errors()->add($key, $message)`.
   */
  addError(field: string, message: string): void {
    if (!this.errorMessages[field]) {
      this.errorMessages[field] = [];
    }
    this.errorMessages[field].push(message);
  }

  /**
   * Get all error messages
   * Laravel: $validator->errors()
   */
  errors(): Record<string, string[]> {
    return this.errorMessages;
  }

  /**
   * Get the first error message for a field, or all messages joined
   * Laravel: $errors->first($key)
   */
  first(field: string): string | undefined {
    return this.errorMessages[field]?.[0];
  }

  /**
   * Check if validation failed
   * Laravel: $validator->fails()
   */
  fails(): boolean {
    return Object.keys(this.errorMessages).length > 0;
  }

  /**
   * Check if validation passed
   * Laravel: $validator->passes()
   */
  passes(): boolean {
    return !this.fails();
  }

  /**
   * Get the validated data
   * Laravel: $validator->validated()
   */
  validated(): Record<string, any> {
    return this.validatedFields;
  }
}
