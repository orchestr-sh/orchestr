import { Request } from '../../Routing/Request';
import { Response } from '../../Routing/Response';
import { ValidationException } from './ValidationException';
import { Validator, ValidationRules } from './Validator';

/**
 * FormRequest - Laravel's form request validation
 * Illuminate\Foundation\Http\FormRequest
 *
 * Provides authorization and validation for incoming HTTP requests.
 * Automatically validates data before reaching the controller.
 */
export abstract class FormRequest {
  protected request: Request;
  protected validator?: Validator;
  protected validatedData?: Record<string, any>;

  constructor(request: Request) {
    this.request = request;
  }

  /**
   * Determine if the user is authorized to make this request
   * Laravel: public function authorize(): bool
   *
   * Override this method to implement authorization logic.
   * Return false to deny access (403 response).
   *
   * @returns {boolean | Promise<boolean>}
   */
  protected authorize(): boolean | Promise<boolean> {
    return true;
  }

  /**
   * Get the validation rules that apply to the request
   * Laravel: public function rules(): array
   *
   * Override this method to define validation rules.
   *
   * @returns {ValidationRules | Promise<ValidationRules>}
   */
  protected abstract rules(): ValidationRules | Promise<ValidationRules>;

  /**
   * Get custom messages for validator errors
   * Laravel: public function messages(): array
   *
   * @returns {Record<string, string>}
   */
  protected messages(): Record<string, string> {
    return {};
  }

  /**
   * Get custom attributes for validator errors
   * Laravel: public function attributes(): array
   *
   * @returns {Record<string, string>}
   */
  protected attributes(): Record<string, string> {
    return {};
  }

  /**
   * Validate the request
   *
   * @throws {ValidationException} If validation fails
   * @throws {Error} If authorization fails
   */
  async validate(): Promise<void> {
    // Check authorization first
    const authorized = await this.authorize();
    if (!authorized) {
      throw new Error('This action is unauthorized.');
    }

    // Get validation rules
    const rules = await this.rules();

    // Create validator
    this.validator = new Validator(
      this.request.all(),
      rules,
      this.messages(),
      this.attributes()
    );

    // Run validation
    const passes = await this.validator.validate();

    if (!passes) {
      throw new ValidationException(this.validator);
    }

    // Store validated data
    this.validatedData = this.validator.validated();
  }

  /**
   * Get the validated data from the request
   * Laravel: $request->validated()
   *
   * @returns {Record<string, any>}
   */
  validated(): Record<string, any> {
    if (!this.validatedData) {
      throw new Error('Validation has not been run yet.');
    }
    return this.validatedData;
  }

  /**
   * Get the validator instance
   *
   * @returns {Validator | undefined}
   */
  getValidator(): Validator | undefined {
    return this.validator;
  }

  /**
   * Get all input data
   * Laravel: $request->all()
   */
  all(): Record<string, any> {
    return this.request.all();
  }

  /**
   * Get an input value
   * Laravel: $request->input('key')
   */
  input(key: string, defaultValue?: any): any {
    return this.request.input(key, defaultValue);
  }

  /**
   * Get only specified inputs
   * Laravel: $request->only(['name', 'email'])
   */
  only(keys: string[]): Record<string, any> {
    return this.request.only(keys);
  }

  /**
   * Get all inputs except specified
   * Laravel: $request->except(['password'])
   */
  except(keys: string[]): Record<string, any> {
    return this.request.except(keys);
  }

  /**
   * Get a route parameter
   * Laravel: $request->route('id')
   */
  routeParam(key: string, defaultValue?: string): string | undefined {
    return this.request.routeParam(key, defaultValue);
  }

  /**
   * Handle a failed authorization attempt
   * Laravel: protected function failedAuthorization()
   *
   * @param {Response} res
   */
  handleFailedAuthorization(res: Response): void {
    res.status(403).json({
      message: 'This action is unauthorized.'
    });
  }

  /**
   * Handle a failed validation attempt
   * Laravel: protected function failedValidation(Validator $validator)
   *
   * @param {Response} res
   * @param {ValidationException} exception
   */
  handleFailedValidation(res: Response, exception: ValidationException): void {
    res.status(422).json({
      message: 'The given data was invalid.',
      errors: exception.errors()
    });
  }

  /**
   * Static factory method to create and validate a FormRequest
   *
   * @param {Request} request
   * @param {Response} res
   * @returns {Promise<T>} The validated FormRequest instance
   */
  static async validate<T extends FormRequest>(
    this: new (request: Request) => T,
    request: Request,
    res: Response
  ): Promise<T> {
    const formRequest = new this(request);

    try {
      await formRequest.validate();
      return formRequest;
    } catch (error) {
      if (error instanceof ValidationException) {
        formRequest.handleFailedValidation(res, error);
        throw error;
      }

      if (error instanceof Error && error.message === 'This action is unauthorized.') {
        formRequest.handleFailedAuthorization(res);
        throw error;
      }

      throw error;
    }
  }
}
