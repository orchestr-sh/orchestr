/**
 * Custom cast stub - the get/set pair Laravel cast classes implement,
 * kept framework-free because Ensemble's string casts own conversion.
 *
 * Laravel: Illuminate\Foundation\Console\CastMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

export class {{ class }} {
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
