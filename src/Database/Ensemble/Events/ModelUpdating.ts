/**
 * ModelUpdating Event
 *
 * Fired before a model is updated (before update query)
 * Returning false from a listener will halt the operation
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { ModelEvent } from './ModelEvent';

export class ModelUpdating<T extends Ensemble = Ensemble> extends ModelEvent<T> {
  constructor(model: T) {
    super(model);
  }
}
