import { Validator } from './Validator';

/**
 * ValidationException - Laravel's validation exception
 * Illuminate\Validation\ValidationException
 *
 * Thrown when validation fails, contains error messages
 */
export class ValidationException extends Error {
  private validator: Validator;
  private status: number = 422;

  constructor(validator: Validator, message?: string) {
    super(message || 'The given data was invalid.');
    this.name = 'ValidationException';
    this.validator = validator;

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ValidationException);
    }
  }

  /**
   * Get the validation errors
   * Laravel: $exception->errors()
   *
   * @returns {Record<string, string[]>}
   */
  errors(): Record<string, string[]> {
    return this.validator.errors();
  }

  /**
   * Get the HTTP status code
   *
   * @returns {number}
   */
  getStatus(): number {
    return this.status;
  }

  /**
   * Set the HTTP status code
   *
   * @param {number} status
   * @returns {this}
   */
  setStatus(status: number): this {
    this.status = status;
    return this;
  }

  /**
   * Get the validator instance
   *
   * @returns {Validator}
   */
  getValidator(): Validator {
    return this.validator;
  }
}
