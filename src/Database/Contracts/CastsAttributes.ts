/**
 * CastsAttributes Contract
 *
 * The get/set pair every custom Ensemble cast implements, mirroring
 * Illuminate\Contracts\Database\Eloquent\CastsAttributes. The `serialize`
 * hook mirrors Laravel's SerializesCastableAttributes: it decides how the
 * cast value is written out by `toObject()` / `toJSON()` without changing
 * what `getAttribute()` hands back in memory.
 *
 * A cast never mutates the model: it reads the stored value and returns the
 * application shape (`get`), and it reads the application value and returns
 * the stored shape (`set`). Whatever `set` returns is exactly what travels
 * into the database bindings.
 */

export interface CastsAttributes<TModel = any, TValue = any> {
  /**
   * Transform the stored value into its application shape.
   * Laravel: CastsAttributes::get()
   */
  get(model: TModel, key: string, value: any, attributes: Record<string, any>): TValue | null | undefined;

  /**
   * Transform the application value before it is stored.
   * Laravel: CastsAttributes::set()
   */
  set(model: TModel, key: string, value: TValue | null | undefined, attributes: Record<string, any>): any;

  /**
   * Prepare the cast value for the model's array/JSON form. Optional: casts
   * without it serialize whatever `get` returned.
   * Laravel: SerializesCastableAttributes::serialize()
   */
  serialize?(model: TModel, key: string, value: any, attributes: Record<string, any>): any;
}
