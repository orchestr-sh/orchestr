/**
 * Validator - Laravel's validation engine
 * Illuminate\Validation\Validator
 *
 * Provides validation rules and error handling
 */

export type ValidationRule = string | Array<string | ValidationRuleObject> | ValidationRuleObject;
export type ValidationRules = Record<string, ValidationRule>;

export interface ValidationRuleObject {
  rule: string;
  message?: string;
}

export class Validator {
  private data: Record<string, any>;
  private rules: ValidationRules;
  private customMessages: Record<string, string>;
  private customAttributes: Record<string, string>;
  private errorMessages: Record<string, string[]> = {};
  private validatedFields: Record<string, any> = {};

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

  /**
   * Validate the data against the rules
   *
   * @returns {Promise<boolean>} True if validation passes
   */
  async validate(): Promise<boolean> {
    this.errorMessages = {};
    this.validatedFields = {};

    for (const [field, rule] of Object.entries(this.rules)) {
      const rules = this.parseRules(rule);
      const items: Array<string | Record<string, any>> =
        typeof rule === 'string'
          ? rule.split('|').map((r) => r.trim())
          : Array.isArray(rule)
            ? rule
            : typeof rule === 'object'
              ? [rule]
              : [];
      const value = this.getFieldValue(field);
      const hasSometimes = rules.includes('sometimes');
      const hasNullable = rules.includes('nullable');

      if (hasSometimes && value === undefined) {
        continue;
      }

      if (hasNullable && (value === undefined || value === null)) {
        if (rules.includes('required')) {
          const result = await this.validateRule(field, value, 'required', []);
          if (!result.passes) {
            this.addError(field, result.message);
          } else {
            this.validatedFields[field] = value;
          }
        } else {
          this.validatedFields[field] = value;
        }
        continue;
      }

      for (const item of items) {
        if (typeof item === 'string') {
          const [ruleKey, ...params] = item.split(':');
          const result = await this.validateRule(field, value, ruleKey, params);
          if (!result.passes) {
            this.addError(field, result.message);
          }
          continue;
        }
        if (
          typeof item === 'object' &&
          item &&
          (item as any).invokable === true &&
          typeof (item as any).passes === 'function'
        ) {
          const attribute = this.getAttribute(field);
          const ctx = {
            field,
            attribute,
            other: (name: string) => this.getFieldValue(name),
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
          const passes = await (item as any).passes(attribute, value, ctx);
          if (!passes) {
            const custom =
              typeof (item as any).messageFor === 'function'
                ? (item as any).messageFor(attribute, value, ctx)
                : typeof (item as any).message === 'function'
                  ? (item as any).message(attribute, value, ctx)
                  : (item as any).message;
            const msg = custom || this.getMessage(field, (item as any).rule || 'rule', `The ${attribute} is invalid.`);
            this.addError(field, msg);
          }
          continue;
        }
        if (typeof item === 'object' && item && 'rule' in item) {
          const [ruleKey, ...params] = String((item as any).rule).split(':');
          const result = await this.validateRule(field, value, ruleKey, params);
          if (!result.passes) {
            this.addError(field, result.message);
          }
          continue;
        }
      }

      // If no errors for this field, add to validated data
      if (!this.errorMessages[field]) {
        this.validatedFields[field] = value;
      }
    }

    return Object.keys(this.errorMessages).length === 0;
  }

  /**
   * Parse validation rules from various formats
   */
  private parseRules(rule: ValidationRule): string[] {
    if (typeof rule === 'string') {
      return rule.split('|').map((r) => r.trim());
    }

    if (Array.isArray(rule)) {
      return rule
        .map((r) => {
          if (typeof r === 'string') {
            return r.trim();
          }
          if (typeof r === 'object' && 'rule' in r) {
            return r.rule;
          }
          return '';
        })
        .filter((r) => r.length > 0);
    }

    if (typeof rule === 'object' && 'rule' in rule) {
      return [rule.rule];
    }

    return [];
  }

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
   * Validate a single rule
   */
  private async validateRule(
    field: string,
    value: any,
    rule: string,
    params: string[]
  ): Promise<{ passes: boolean; message: string }> {
    const attribute = this.getAttribute(field);
    const listParams = params.length
      ? params
          .join(':')
          .split(/[,:]/)
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
      : [];
    const other = (name: string) => this.getFieldValue(name);
    const isPresent = (v: any) => v !== undefined;
    const isEmpty = (v: any) => v === undefined || v === null || v === '';
    const toNumber = (v: any) => (typeof v === 'number' ? v : parseFloat(String(v)));
    const toString = (v: any) => (typeof v === 'string' ? v : String(v));
    const isDate = (v: any) => {
      const d = new Date(v);
      return !isNaN(d.getTime());
    };

    switch (rule) {
      case 'bail':
        return { passes: true, message: '' };

      case 'exclude':
        return { passes: true, message: '' };

      case 'exclude_if': {
        const [otherField, expected] = params;
        const ov = other(otherField);
        if (toString(ov) === expected) {
          return { passes: true, message: '' };
        }
        return { passes: true, message: '' };
      }

      case 'exclude_unless': {
        const [otherField, expected] = params;
        const ov = other(otherField);
        if (toString(ov) !== expected) {
          return { passes: true, message: '' };
        }
        return { passes: true, message: '' };
      }
      case 'required':
        if (value === undefined || value === null || value === '') {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} field is required.`),
          };
        }
        return { passes: true, message: '' };

      case 'required_if': {
        const [otherField, expected] = params;
        const ov = other(otherField);
        if (toString(ov) === expected && isEmpty(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} field is required.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'required_unless': {
        const [otherField, expected] = params;
        const ov = other(otherField);
        if (toString(ov) !== expected && isEmpty(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} field is required.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'required_with': {
        const others = listParams;
        if (others.some((o) => isPresent(other(o))) && isEmpty(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} field is required.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'required_with_all': {
        const others = listParams;
        if (others.every((o) => isPresent(other(o))) && isEmpty(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} field is required.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'required_without': {
        const others = listParams;
        if (others.some((o) => !isPresent(other(o))) && isEmpty(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} field is required.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'required_without_all': {
        const others = listParams;
        if (others.every((o) => !isPresent(other(o))) && isEmpty(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} field is required.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'present':
        if (!isPresent(value)) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} field must be present.`) };
        }
        return { passes: true, message: '' };

      case 'filled':
        if (isPresent(value) && isEmpty(value)) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must have a value.`) };
        }
        return { passes: true, message: '' };

      case 'accepted': {
        const acceptedValues = ['yes', 'on', '1', 1, true, 'true'];
        if (!acceptedValues.includes(value)) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must be accepted.`) };
        }
        return { passes: true, message: '' };
      }

      case 'accepted_if': {
        const [otherField, expected] = params;
        const ov = other(otherField);
        if (toString(ov) === expected) {
          const acceptedValues = ['yes', 'on', '1', 1, true, 'true'];
          if (!acceptedValues.includes(value)) {
            return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must be accepted.`) };
          }
        }
        return { passes: true, message: '' };
      }

      case 'declined': {
        const declinedValues = ['no', 'off', '0', 0, false, 'false'];
        if (!declinedValues.includes(value)) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must be declined.`) };
        }
        return { passes: true, message: '' };
      }

      case 'declined_if': {
        const [otherField, expected] = params;
        const ov = other(otherField);
        if (toString(ov) === expected) {
          const declinedValues = ['no', 'off', '0', 0, false, 'false'];
          if (!declinedValues.includes(value)) {
            return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must be declined.`) };
          }
        }
        return { passes: true, message: '' };
      }
      case 'nullable':
        return { passes: true, message: '' };

      case 'sometimes':
        return { passes: true, message: '' };

      case 'email':
        if (value && !this.isValidEmail(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be a valid email address.`),
          };
        }
        return { passes: true, message: '' };

      case 'string':
        if (value && typeof value !== 'string') {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be a string.`),
          };
        }
        return { passes: true, message: '' };

      case 'numeric':
      case 'number':
        if (value && isNaN(Number(value))) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be a number.`),
          };
        }
        return { passes: true, message: '' };

      case 'integer':
        if (value && (!Number.isInteger(Number(value)) || isNaN(Number(value)))) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be an integer.`),
          };
        }
        return { passes: true, message: '' };

      case 'boolean':
        if (
          value !== undefined &&
          typeof value !== 'boolean' &&
          value !== 'true' &&
          value !== 'false' &&
          value !== 1 &&
          value !== 0
        ) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be true or false.`),
          };
        }
        return { passes: true, message: '' };

      case 'min': {
        const minValue = params[0];
        if (typeof value === 'string' && value.length < parseInt(minValue)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be at least ${minValue} characters.`),
          };
        }
        if (typeof value === 'number' && value < parseFloat(minValue)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be at least ${minValue}.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'max': {
        const maxValue = params[0];
        if (typeof value === 'string' && value.length > parseInt(maxValue)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} may not be greater than ${maxValue} characters.`),
          };
        }
        if (typeof value === 'number' && value > parseFloat(maxValue)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} may not be greater than ${maxValue}.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'between': {
        const [minBetween, maxBetween] = params;
        const numValue = typeof value === 'string' ? value.length : Number(value);
        if (numValue < parseFloat(minBetween) || numValue > parseFloat(maxBetween)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be between ${minBetween} and ${maxBetween}.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'size': {
        const sizeValue = params[0];
        if (typeof value === 'string' && value.length !== parseInt(sizeValue)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be ${sizeValue} characters.`),
          };
        }
        if (typeof value === 'number' && value !== parseFloat(sizeValue)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be ${sizeValue}.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'in':
        if (value && !listParams.includes(String(value))) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The selected ${attribute} is invalid.`),
          };
        }
        return { passes: true, message: '' };

      case 'not_in':
        if (value && listParams.includes(String(value))) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The selected ${attribute} is invalid.`),
          };
        }
        return { passes: true, message: '' };

      case 'array':
        if (value && !Array.isArray(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be an array.`),
          };
        }
        return { passes: true, message: '' };

      case 'confirmed': {
        const confirmationField = `${field}_confirmation`;
        const confirmationValue = this.data[confirmationField];
        if (value !== confirmationValue) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} confirmation does not match.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'url':
        if (value && !this.isValidUrl(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be a valid URL.`),
          };
        }
        return { passes: true, message: '' };

      case 'alpha':
        if (value && !/^[a-zA-Z]+$/.test(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} may only contain letters.`),
          };
        }
        return { passes: true, message: '' };

      case 'alpha_num':
        if (value && !/^[a-zA-Z0-9]+$/.test(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} may only contain letters and numbers.`),
          };
        }
        return { passes: true, message: '' };

      case 'alpha_dash':
        if (value && !/^[a-zA-Z0-9_-]+$/.test(value)) {
          return {
            passes: false,
            message: this.getMessage(
              field,
              rule,
              `The ${attribute} may only contain letters, numbers, dashes and underscores.`
            ),
          };
        }
        return { passes: true, message: '' };

      case 'regex': {
        const pattern = new RegExp(params.join(':'));
        if (value && !pattern.test(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} format is invalid.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'not_regex': {
        const pattern = new RegExp(params.join(':'));
        if (value && pattern.test(value)) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} format is invalid.`) };
        }
        return { passes: true, message: '' };
      }

      case 'json':
        if (value) {
          try {
            JSON.parse(typeof value === 'string' ? value : String(value));
          } catch {
            return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must be a valid JSON.`) };
          }
        }
        return { passes: true, message: '' };

      case 'ascii':
        if (value && /[^\x00-\x7F]/.test(toString(value))) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must be ASCII characters.`) };
        }
        return { passes: true, message: '' };

      case 'decimal': {
        const places = params[0] ? parseInt(params[0]) : undefined;
        if (value !== undefined) {
          const s = toString(value);
          const m = s.match(/^[-+]?\d+(\.(\d+))?$/);
          if (!m) {
            return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must be a decimal.`) };
          }
          if (places !== undefined) {
            const dp = m[2]?.length || 0;
            if (dp !== places) {
              return {
                passes: false,
                message: this.getMessage(field, rule, `The ${attribute} must have ${places} decimal places.`),
              };
            }
          }
        }
        return { passes: true, message: '' };
      }

      case 'starts_with':
        if (value) {
          const s = toString(value);
          if (!listParams.some((p) => s.startsWith(p))) {
            return {
              passes: false,
              message: this.getMessage(
                field,
                rule,
                `The ${attribute} must start with one of: ${listParams.join(', ')}.`
              ),
            };
          }
        }
        return { passes: true, message: '' };

      case 'ends_with':
        if (value) {
          const s = toString(value);
          if (!listParams.some((p) => s.endsWith(p))) {
            return {
              passes: false,
              message: this.getMessage(field, rule, `The ${attribute} must end with one of: ${listParams.join(', ')}.`),
            };
          }
        }
        return { passes: true, message: '' };

      case 'distinct':
        if (Array.isArray(value)) {
          const set = new Set(value.map((v) => JSON.stringify(v)));
          if (set.size !== value.length) {
            return {
              passes: false,
              message: this.getMessage(field, rule, `The ${attribute} must not have duplicates.`),
            };
          }
        }
        return { passes: true, message: '' };

      case 'same': {
        const [otherField] = params;
        if (toString(value) !== toString(other(otherField))) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must match ${otherField}.`) };
        }
        return { passes: true, message: '' };
      }

      case 'different': {
        const [otherField] = params;
        if (toString(value) === toString(other(otherField))) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be different from ${otherField}.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'gt': {
        const [otherFieldOrValue] = params;
        const cmp = isNaN(Number(otherFieldOrValue)) ? other(otherFieldOrValue) : parseFloat(otherFieldOrValue);
        if (!(toNumber(value) > toNumber(cmp))) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be greater than ${otherFieldOrValue}.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'gte': {
        const [otherFieldOrValue] = params;
        const cmp = isNaN(Number(otherFieldOrValue)) ? other(otherFieldOrValue) : parseFloat(otherFieldOrValue);
        if (!(toNumber(value) >= toNumber(cmp))) {
          return {
            passes: false,
            message: this.getMessage(
              field,
              rule,
              `The ${attribute} must be greater than or equal to ${otherFieldOrValue}.`
            ),
          };
        }
        return { passes: true, message: '' };
      }

      case 'lt': {
        const [otherFieldOrValue] = params;
        const cmp = isNaN(Number(otherFieldOrValue)) ? other(otherFieldOrValue) : parseFloat(otherFieldOrValue);
        if (!(toNumber(value) < toNumber(cmp))) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be less than ${otherFieldOrValue}.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'lte': {
        const [otherFieldOrValue] = params;
        const cmp = isNaN(Number(otherFieldOrValue)) ? other(otherFieldOrValue) : parseFloat(otherFieldOrValue);
        if (!(toNumber(value) <= toNumber(cmp))) {
          return {
            passes: false,
            message: this.getMessage(
              field,
              rule,
              `The ${attribute} must be less than or equal to ${otherFieldOrValue}.`
            ),
          };
        }
        return { passes: true, message: '' };
      }

      case 'uuid':
        if (
          value &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{4}-[0-9a-f]{12}$/i.test(toString(value))
        ) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must be a valid UUID.`) };
        }
        return { passes: true, message: '' };

      case 'timezone':
        if (value) {
          const v = toString(value);
          const zones = (Intl as any).supportedValuesOf ? (Intl as any).supportedValuesOf('timeZone') : [];
          if (!zones.includes(v)) {
            return {
              passes: false,
              message: this.getMessage(field, rule, `The ${attribute} must be a valid timezone.`),
            };
          }
        }
        return { passes: true, message: '' };

      case 'date':
        if (value && !isDate(value)) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} is not a valid date.`) };
        }
        return { passes: true, message: '' };

      case 'date_equals':
        if (value) {
          const d1 = new Date(value).getTime();
          const d2 = new Date(params[0]).getTime();
          if (isNaN(d1) || isNaN(d2) || d1 !== d2) {
            return {
              passes: false,
              message: this.getMessage(field, rule, `The ${attribute} must equal ${params[0]}.`),
            };
          }
        }
        return { passes: true, message: '' };

      case 'after': {
        const cmp = params[0];
        const v = new Date(value).getTime();
        const ov = other(cmp);
        const c = isDate(ov) ? new Date(ov).getTime() : new Date(cmp).getTime();
        if (isNaN(v) || isNaN(c) || v <= c) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must be after ${cmp}.`) };
        }
        return { passes: true, message: '' };
      }

      case 'after_or_equal': {
        const cmp = params[0];
        const v = new Date(value).getTime();
        const ov = other(cmp);
        const c = isDate(ov) ? new Date(ov).getTime() : new Date(cmp).getTime();
        if (isNaN(v) || isNaN(c) || v < c) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be after or equal to ${cmp}.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'before': {
        const cmp = params[0];
        const v = new Date(value).getTime();
        const ov = other(cmp);
        const c = isDate(ov) ? new Date(ov).getTime() : new Date(cmp).getTime();
        if (isNaN(v) || isNaN(c) || v >= c) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must be before ${cmp}.`) };
        }
        return { passes: true, message: '' };
      }

      case 'before_or_equal': {
        const cmp = params[0];
        const v = new Date(value).getTime();
        const ov = other(cmp);
        const c = isDate(ov) ? new Date(ov).getTime() : new Date(cmp).getTime();
        if (isNaN(v) || isNaN(c) || v > c) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be before or equal to ${cmp}.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'digits': {
        const len = parseInt(params[0]);
        if (!/^\d+$/.test(String(value)) || String(value).length !== len) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must be ${len} digits.`) };
        }
        return { passes: true, message: '' };
      }

      case 'digits_between': {
        const minD = parseInt(params[0]);
        const maxD = parseInt(params[1]);
        const s = String(value);
        if (!/^\d+$/.test(s) || s.length < minD || s.length > maxD) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be between ${minD} and ${maxD} digits.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'min_digits': {
        const minD = parseInt(params[0]);
        const s = String(value);
        if (!/^\d+$/.test(s) || s.length < minD) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be at least ${minD} digits.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'max_digits': {
        const maxD = parseInt(params[0]);
        const s = String(value);
        if (!/^\d+$/.test(s) || s.length > maxD) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be at most ${maxD} digits.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'multiple_of': {
        const base = parseFloat(params[0]);
        if (Number.isFinite(base) && toNumber(value) % base !== 0) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be a multiple of ${base}.`),
          };
        }
        return { passes: true, message: '' };
      }

      case 'ip':
        if (value && !/^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(toString(value))) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be a valid IP address.`),
          };
        }
        return { passes: true, message: '' };

      case 'ipv4':
        if (value && !/^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(toString(value))) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be a valid IPv4 address.`),
          };
        }
        return { passes: true, message: '' };

      case 'ipv6':
        if (value && !/^([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i.test(toString(value))) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be a valid IPv6 address.`),
          };
        }
        return { passes: true, message: '' };

      case 'mac_address':
        if (value && !/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(toString(value))) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be a valid MAC address.`),
          };
        }
        return { passes: true, message: '' };

      case 'lowercase':
        if (value && toString(value) !== toString(value).toLowerCase()) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must be lowercase.`) };
        }
        return { passes: true, message: '' };

      case 'uppercase':
        if (value && toString(value) !== toString(value).toUpperCase()) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must be uppercase.`) };
        }
        return { passes: true, message: '' };

      case 'in_array': {
        const [otherField] = params;
        const arr = other(otherField);
        if (!Array.isArray(arr) || !arr.map((v: any) => String(v)).includes(String(value))) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must be in ${otherField}.`) };
        }
        return { passes: true, message: '' };
      }

      case 'prohibited':
        if (isPresent(value)) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} field is prohibited.`) };
        }
        return { passes: true, message: '' };

      case 'prohibited_if': {
        const [otherField, expected] = params;
        const ov = other(otherField);
        if (toString(ov) === expected && isPresent(value)) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} field is prohibited.`) };
        }
        return { passes: true, message: '' };
      }

      case 'prohibited_unless': {
        const [otherField, expected] = params;
        const ov = other(otherField);
        if (toString(ov) !== expected && isPresent(value)) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} field is prohibited.`) };
        }
        return { passes: true, message: '' };
      }

      case 'prohibits': {
        const others = listParams;
        if (isPresent(value) && others.some((o) => isPresent(other(o)))) {
          return {
            passes: false,
            message: this.getMessage(
              field,
              rule,
              `The ${attribute} prohibits ${others.join(', ')} from being present.`
            ),
          };
        }
        return { passes: true, message: '' };
      }

      case 'file':
        if (value && typeof value !== 'object') {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must be a file.`) };
        }
        return { passes: true, message: '' };

      case 'image':
        if (value && typeof value === 'object') {
          const type = (value.mimetype || value.type || '').toString();
          if (!type.startsWith('image/')) {
            return { passes: false, message: this.getMessage(field, rule, `The ${attribute} must be an image.`) };
          }
        }
        return { passes: true, message: '' };

      case 'mimetypes': {
        const allowed = listParams;
        if (value && typeof value === 'object') {
          const type = (value.mimetype || value.type || '').toString();
          if (!allowed.includes(type)) {
            return {
              passes: false,
              message: this.getMessage(field, rule, `The ${attribute} has an invalid mimetype.`),
            };
          }
        }
        return { passes: true, message: '' };
      }

      case 'mimes': {
        const allowed = listParams;
        if (value && typeof value === 'object') {
          const type = (value.mimetype || value.type || '').toString();
          const ext = (value.extension || '').toString();
          if (!(allowed.includes(ext) || allowed.some((m) => type.endsWith(`/${m}`)))) {
            return {
              passes: false,
              message: this.getMessage(field, rule, `The ${attribute} has an invalid file type.`),
            };
          }
        }
        return { passes: true, message: '' };
      }

      case 'active_url':
        if (value && !this.isValidUrl(value)) {
          return { passes: false, message: this.getMessage(field, rule, `The ${attribute} is not a valid URL.`) };
        }
        return { passes: true, message: '' };

      default:
        console.warn(`Unknown validation rule: ${rule}`);
        return { passes: true, message: '' };
    }
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get custom message or default message
   */
  private getMessage(field: string, rule: string, defaultMessage: string): string {
    const customKey = `${field}.${rule}`;
    return this.customMessages[customKey] || this.customMessages[rule] || defaultMessage;
  }

  /**
   * Get custom attribute name or use field name
   */
  private getAttribute(field: string): string {
    return this.customAttributes[field] || field.replace(/_/g, ' ');
  }

  /**
   * Add an error message for a field
   */
  private addError(field: string, message: string): void {
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
