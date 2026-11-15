/**
 * Model stub - the Ensemble-backed class `make:model` writes.
 *
 * Laravel: Illuminate\Foundation\Console\ModelMakeCommand (model.stub).
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

import { Ensemble } from '@orchestr-sh/orchestr';

export class {{ class }} extends Ensemble {
  protected table = '{{ table }}';

  // static fillable = ['name'];
}
`;
