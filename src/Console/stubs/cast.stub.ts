/**
 * Custom cast stub - the get/set pair Laravel cast classes implement,
 * typed against the package's CastsAttributes contract so registration
 * (`CastRegistry.register`) and the model's casts map both accept it.
 *
 * Laravel: Illuminate\Foundation\Console\CastMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

import type { CastsAttributes } from '@orchestr-sh/orchestr';

export class {{ class }} implements CastsAttributes {
  /**
   * Transform the stored value into its application shape.
   * Laravel: Illuminate\\Contracts\\Database\\Eloquent\\CastsAttributes::get()
   */
  get(model: any, key: string, value: any, attributes: Record<string, any>): any {
    return value;
  }

  /**
   * Transform the application value before it is stored.
   * Laravel: Illuminate\\Contracts\\Database\\Eloquent\\CastsAttributes::set()
   */
  set(model: any, key: string, value: any, attributes: Record<string, any>): any {
    return value;
  }
}
`;
