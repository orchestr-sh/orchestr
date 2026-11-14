/**
 * JSON resource stub.
 *
 * Laravel: Illuminate\Foundation\Console\ResourceMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

import { JsonResource } from '@orchestr-sh/orchestr';

export class {{ class }} extends JsonResource {
  /**
   * Transform the resource into an array.
   */
  toArray(request?: any): Record<string, any> {
    return {
      // Example: id: this.resource.getKey(),
    };
  }
}
`;
