import type { ValidationRules } from '@/Foundation/Http/Validator';
import { Request } from './Request';
import { Response } from './Response';

/**
 * Controller - Laravel's base controller
 * Illuminate\Routing\Controller
 */
export abstract class Controller {
  /**
   * Validate the given request with the given rules
   * Laravel: $this->validate($request, $rules)
   *
   * Delegates to Request::validate: a ValidationException (422 with the
   * error bag via the exception handler) is thrown when validation fails
   * and the validated data is returned on success.
   */
  protected validate(
    request: Request,
    rules: ValidationRules,
    messages: Record<string, string> = {},
    attributes: Record<string, string> = {}
  ): Promise<Record<string, any>> {
    return request.validate(rules, messages, attributes);
  }

  /**
   * Execute an action on the controller
   */
  public callAction(method: string, parameters: any[]): any {
    return (this as any)[method](...parameters);
  }
}
