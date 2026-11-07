/**
 * ModelForceDeleting Event
 *
 * Fired before a model is hard deleted, bypassing soft deletes
 * Returning false from a listener will halt the operation
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { ModelEvent } from './ModelEvent';

export class ModelForceDeleting<T extends Ensemble = Ensemble> extends ModelEvent<T> {
  constructor(model: T) {
    super(model);
  }
}
