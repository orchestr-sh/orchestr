/**
 * ModelSaving Event
 *
 * Fired before a model is saved (before insert or update)
 * Returning false from a listener will halt the operation
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { ModelEvent } from './ModelEvent';

export class ModelSaving<T extends Ensemble = Ensemble> extends ModelEvent<T> {
  constructor(model: T) {
    super(model);
  }
}
