/**
 * Pivot model stub - the join-table model `make:model --pivot` writes.
 *
 * Laravel: the pivot branch of ModelMakeCommand (pivot.stub).
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

import { Ensemble } from '@orchestr-sh/orchestr';

export class {{ class }} extends Ensemble {
  /**
   * The join table shared by the parent models; the migration for it is
   * owned by whoever created the relationship.
   */
  protected table = '{{ table }}';
}
`;
