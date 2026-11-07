/**
 * ModelSoftDeleted Event
 *
 * Fired after a soft-deleting model has stamped its "deleted at" column
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { ModelEvent } from './ModelEvent';

export class ModelSoftDeleted<T extends Ensemble = Ensemble> extends ModelEvent<T> {
  constructor(model: T) {
    super(model);
  }
}
