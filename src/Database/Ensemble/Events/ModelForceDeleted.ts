/**
 * ModelForceDeleted Event
 *
 * Fired after a model has been hard deleted, bypassing soft deletes
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { ModelEvent } from './ModelEvent';

export class ModelForceDeleted<T extends Ensemble = Ensemble> extends ModelEvent<T> {
  constructor(model: T) {
    super(model);
  }
}
