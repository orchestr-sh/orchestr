/**
 * ModelCreating Event
 *
 * Fired before a new model is created (before insert)
 * Returning false from a listener will halt the operation
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { ModelEvent } from './ModelEvent';

export class ModelCreating<T extends Ensemble = Ensemble> extends ModelEvent<T> {
  constructor(model: T) {
    super(model);
  }
}
