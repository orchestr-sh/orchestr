/**
 * ModelSoftDeleting Event
 *
 * Fired while a soft-deleting model stamps its "deleted at" column, after the
 * halting `deleting` event and before the row is updated
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { ModelEvent } from './ModelEvent';

export class ModelSoftDeleting<T extends Ensemble = Ensemble> extends ModelEvent<T> {
  constructor(model: T) {
    super(model);
  }
}
