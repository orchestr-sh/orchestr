/**
 * Validator - Laravel's validation engine
 * Illuminate\Validation\Validator
 *
 * Provides validation rules and error handling
 */

export type ValidationRule = string | string[] | ValidationRuleObject;
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
      const value = this.getFieldValue(field);

      for (const ruleName of rules) {
        const [ruleKey, ...params] = ruleName.split(':');
        const result = await this.validateRule(field, value, ruleKey, params);

        if (!result.passes) {
          this.addError(field, result.message);
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
      return rule.split('|').map(r => r.trim());
    }

    if (Array.isArray(rule)) {
      return rule;
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

    switch (rule) {
      case 'required':
        if (value === undefined || value === null || value === '') {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} field is required.`)
          };
        }
        return { passes: true, message: '' };

      case 'email':
        if (value && !this.isValidEmail(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be a valid email address.`)
          };
        }
        return { passes: true, message: '' };

      case 'string':
        if (value && typeof value !== 'string') {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be a string.`)
          };
        }
        return { passes: true, message: '' };

      case 'numeric':
      case 'number':
        if (value && isNaN(Number(value))) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be a number.`)
          };
        }
        return { passes: true, message: '' };

      case 'integer':
        if (value && (!Number.isInteger(Number(value)) || isNaN(Number(value)))) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be an integer.`)
          };
        }
        return { passes: true, message: '' };

      case 'boolean':
        if (value !== undefined && typeof value !== 'boolean' && value !== 'true' && value !== 'false' && value !== 1 && value !== 0) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be true or false.`)
          };
        }
        return { passes: true, message: '' };

      case 'min':
        const minValue = params[0];
        if (typeof value === 'string' && value.length < parseInt(minValue)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be at least ${minValue} characters.`)
          };
        }
        if (typeof value === 'number' && value < parseFloat(minValue)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be at least ${minValue}.`)
          };
        }
        return { passes: true, message: '' };

      case 'max':
        const maxValue = params[0];
        if (typeof value === 'string' && value.length > parseInt(maxValue)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} may not be greater than ${maxValue} characters.`)
          };
        }
        if (typeof value === 'number' && value > parseFloat(maxValue)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} may not be greater than ${maxValue}.`)
          };
        }
        return { passes: true, message: '' };

      case 'between':
        const [minBetween, maxBetween] = params;
        const numValue = typeof value === 'string' ? value.length : Number(value);
        if (numValue < parseFloat(minBetween) || numValue > parseFloat(maxBetween)) {
          return {
            passes: false,
            message: this.getMessage(
              field,
              rule,
              `The ${attribute} must be between ${minBetween} and ${maxBetween}.`
            )
          };
        }
        return { passes: true, message: '' };

      case 'in':
        if (value && !params.includes(String(value))) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The selected ${attribute} is invalid.`)
          };
        }
        return { passes: true, message: '' };

      case 'not_in':
        if (value && params.includes(String(value))) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The selected ${attribute} is invalid.`)
          };
        }
        return { passes: true, message: '' };

      case 'array':
        if (value && !Array.isArray(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be an array.`)
          };
        }
        return { passes: true, message: '' };

      case 'confirmed':
        const confirmationField = `${field}_confirmation`;
        const confirmationValue = this.data[confirmationField];
        if (value !== confirmationValue) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} confirmation does not match.`)
          };
        }
        return { passes: true, message: '' };

      case 'url':
        if (value && !this.isValidUrl(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} must be a valid URL.`)
          };
        }
        return { passes: true, message: '' };

      case 'alpha':
        if (value && !/^[a-zA-Z]+$/.test(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} may only contain letters.`)
          };
        }
        return { passes: true, message: '' };

      case 'alpha_num':
        if (value && !/^[a-zA-Z0-9]+$/.test(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} may only contain letters and numbers.`)
          };
        }
        return { passes: true, message: '' };

      case 'alpha_dash':
        if (value && !/^[a-zA-Z0-9_-]+$/.test(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} may only contain letters, numbers, dashes and underscores.`)
          };
        }
        return { passes: true, message: '' };

      case 'regex':
        const pattern = new RegExp(params.join(':'));
        if (value && !pattern.test(value)) {
          return {
            passes: false,
            message: this.getMessage(field, rule, `The ${attribute} format is invalid.`)
          };
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
