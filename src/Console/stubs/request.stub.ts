/**
 * Form request stub.
 *
 * Laravel: Illuminate\Foundation\Console\RequestMakeCommand (request.stub).
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

import { FormRequest } from '@orchestr-sh/orchestr';
import type { ValidationRules } from '@orchestr-sh/orchestr';

export class {{ class }} extends FormRequest {
  /**
   * Determine if the user is authorized to make this request.
   */
  protected authorize(): boolean {
    return true;
  }

  /**
   * Get the validation rules that apply to the request.
   */
  protected rules(): ValidationRules {
    return {
      //
    };
  }

  /**
   * Get custom attributes for validator errors.
   */
  protected attributes(): Record<string, string> {
    return {
      //
    };
  }
}
`;
