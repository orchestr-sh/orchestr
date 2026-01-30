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
   */
  protected validate(request: Request, rules: Record<string, any>): Promise<Record<string, any>> {
    // Validation implementation would go here
    // For now, just return the data
    return Promise.resolve(request.all());
  }

  /**
   * Execute an action on the controller
   */
  public callAction(method: string, parameters: any[]): any {
    return (this as any)[method](...parameters);
  }
}
