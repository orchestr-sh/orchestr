import { HttpException } from '@/Foundation/Exceptions/HttpException';
import { Validator } from './Validator';

/**
 * ValidationException - Laravel's validation exception
 * Illuminate\Validation\ValidationException
 *
 * Thrown when validation fails, contains error messages. As a 422
 * HttpException the exception handler renders its error bag onto the
 * response.
 */
export class ValidationException extends HttpException {
  private validator: Validator;

  constructor(validator: Validator, message?: string) {
    super(422, message || 'The given data was invalid.');
    this.name = 'ValidationException';
    this.validator = validator;

    // Keep instanceof working when the output is down-levelled
    Object.setPrototypeOf(this, ValidationException.prototype);

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
