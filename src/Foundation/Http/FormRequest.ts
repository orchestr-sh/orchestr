import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import { AuthorizationException } from '@/Auth/Access/AuthorizationException';
import { Response } from '@/Auth/Access/Response';
import { Request } from '@/Routing/Request';
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
   * Override this method to implement authorization logic. Return false,
   * or a denied `Response`, to reject the request (the exception handler
   * renders the resulting AuthorizationException as a 403). Checking the
   * action through `can()`/`user()` keeps the gate as the single place
   * abilities resolve (DRY).
   *
   * @returns {boolean | Response | Promise<boolean | Response>}
   */
  protected authorize(): boolean | Response | Promise<boolean | Response> {
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
   * @throws {AuthorizationException} If authorization fails (rendered as a 403)
   */
  async validate(): Promise<void> {
    // Check authorization first; a denied Response throws with its own
    // message/status, a false verdict falls back to the generic denial
    const authorization = await this.authorize();

    if (authorization instanceof Response) {
      authorization.authorize();
    } else if (!authorization) {
      throw new AuthorizationException();
    }

    // Get validation rules
    const rules = await this.rules();

    // Create validator
    this.validator = new Validator(this.request.all(), rules, this.messages(), this.attributes());

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
   * The authenticated user behind this request
   * Laravel: $request->user() (FormRequest extends Request)
   */
  async user<T extends Authenticatable = Authenticatable>(guard?: string): Promise<T | null> {
    return this.request.user<T>(guard);
  }

  /**
   * Determine whether the request's user passes the gate check - the
   * convenience authorize() implementations lean on so abilities resolve
   * in the one shared Gate (DRY)
   * Laravel: $request->can($ability, $arguments)
   */
  async can(ability: string, args: any = []): Promise<boolean> {
    return this.request.can(ability, args);
  }

  /**
   * Static factory method to create and validate a FormRequest
   *
   * Validation and authorization failures throw ValidationException and
   * AuthorizationException respectively; the exception handler renders the
   * corresponding response (422 and 403), so nothing is written here.
   *
   * @param {Request} request
   * @returns {Promise<T>} The validated FormRequest instance
   */
  static async validate<T extends FormRequest>(this: new (request: Request) => T, request: Request): Promise<T> {
    const formRequest = new this(request);
    await formRequest.validate();

    return formRequest;
  }
}
