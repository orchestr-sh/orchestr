import { BaseRule } from './Base';

/**
 * Options accepted by the password rule, mirroring
 * Illuminate\Validation\Rules\Password
 */
export interface PasswordOptions {
  /** Minimum length (Laravel default: 8) */
  min?: number;
  /** Maximum length (Laravel: ->max()) */
  max?: number;
  /** Require at least one letter */
  letters?: boolean;
  /** Require both upper and lower case letters */
  mixedCase?: boolean;
  /** Require at least one digit */
  numbers?: boolean;
  /** Require at least one symbol */
  symbols?: boolean;
  /**
   * Reject known-leaked passwords. Local/no-network implementation:
   * checked against a bundled list of frequently exposed passwords
   * instead of Laravel's HaveIBeenPwned call, so it works offline and
   * never sends the value (or its hash prefix) anywhere.
   */
  uncompromised?: boolean;
}

/**
 * The defaults behind Laravel's `password` string rule / Password::defaults():
 * a minimum length of 8. The stricter checks below are opt-in through the
 * fluent methods (or extra parameters), matching Laravel.
 */
export const PASSWORD_DEFAULTS: PasswordOptions = {
  min: 8,
};

/**
 * A slice of the most frequently leaked passwords (top of public
 * breach-frequency lists). `uncompromised()` matches case-insensitively;
 * applications that need real breach corpora should layer their own check.
 */
const COMPROMISED_PASSWORDS = new Set([
  '123456',
  '123456789',
  'password',
  '12345678',
  'qwerty',
  '1234567',
  '12345',
  '1234567890',
  'letmein',
  'welcome',
  'admin',
  'abc123',
  'password1',
  'iloveyou',
  'qwerty123',
  'monkey',
  'dragon',
  'football',
  'passw0rd',
  '111111',
]);

/**
 * Enforce the configured password options and return the first failure
 * message, or null when the value passes. Shared by the invokable
 * PasswordRule and the `password` string rule (DRY).
 */
export function checkPassword(value: any, options: PasswordOptions, attribute: string): string | null {
  const password = typeof value === 'string' ? value : '';

  if (options.min !== undefined && password.length < options.min) {
    return `The ${attribute} must be at least ${options.min} characters.`;
  }

  if (options.max !== undefined && password.length > options.max) {
    return `The ${attribute} may not be greater than ${options.max} characters.`;
  }

  if (options.letters && !/[A-Za-z]/.test(password)) {
    return `The ${attribute} must contain letters.`;
  }

  if (options.mixedCase && (!/[a-z]/.test(password) || !/[A-Z]/.test(password))) {
    return `The ${attribute} must contain mixed case letters.`;
  }

  if (options.numbers && !/\d/.test(password)) {
    return `The ${attribute} must contain numbers.`;
  }

  if (options.symbols && !/[^A-Za-z0-9]/.test(password)) {
    return `The ${attribute} must contain symbols.`;
  }

  if (options.uncompromised && COMPROMISED_PASSWORDS.has(password.toLowerCase())) {
    return `The ${attribute} has appeared in a data leak. Please choose a different ${attribute}.`;
  }

  return null;
}

/**
 * Rule.password() - a fluent password constraint, validated locally
 * against the configured options.
 *
 * Laravel: Illuminate\Validation\Rules\Password
 *
 * @example
 * ```typescript
 * Rule.password().min(12).letters().mixedCase().numbers().symbols().uncompromised()
 * ```
 */
export class PasswordRule extends BaseRule {
  private options: PasswordOptions;

  /**
   * The first failing message from the latest passes() run, surfaced by
   * messageFor
   */
  private lastFailure: string | null = null;

  constructor(min: number = 8) {
    super('password');
    this.invokable = true;
    this.options = { ...PASSWORD_DEFAULTS, min };
  }

  /**
   * Require a minimum length
   * Laravel: Password::min()
   */
  min(length: number): this {
    this.options.min = length;
    return this;
  }

  /**
   * Cap the length
   * Laravel: Password::max()
   */
  max(length: number): this {
    this.options.max = length;
    return this;
  }

  /**
   * Require at least one letter
   * Laravel: Password::letters()
   */
  letters(): this {
    this.options.letters = true;
    return this;
  }

  /**
   * Require upper and lower case letters
   * Laravel: Password::mixedCase()
   */
  mixedCase(): this {
    this.options.mixedCase = true;
    return this;
  }

  /**
   * Require at least one number
   * Laravel: Password::numbers()
   */
  numbers(): this {
    this.options.numbers = true;
    return this;
  }

  /**
   * Require at least one symbol
   * Laravel: Password::symbols()
   */
  symbols(): this {
    this.options.symbols = true;
    return this;
  }

  /**
   * Reject locally known leaked passwords (offline list, no network)
   * Laravel: Password::uncompromised()
   */
  uncompromised(check: boolean = true): this {
    this.options.uncompromised = check;
    return this;
  }

  /**
   * The configured constraints
   */
  getOptions(): PasswordOptions {
    return { ...this.options };
  }

  /**
   * Validate the value against the configured options. Like Laravel's
   * non-implicit rules, a missing value passes: chain `required` to
   * enforce presence.
   * Laravel: Password::passes()
   */
  passes(attribute: string, value: any): boolean {
    if (value === undefined || value === null) {
      this.lastFailure = null;
      return true;
    }

    this.lastFailure = checkPassword(value, this.options, attribute);

    return this.lastFailure === null;
  }

  /**
   * The failure message from the latest run (or a custom message set with
   * ->message())
   * Laravel: Password::message()
   */
  messageFor(attribute: string): string {
    if (this.message) {
      return this.message;
    }

    return this.lastFailure ?? `The ${attribute} is invalid.`;
  }
}
