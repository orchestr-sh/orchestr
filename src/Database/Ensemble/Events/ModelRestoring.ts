/**
 * ModelRestoring Event
 *
 * Fired before a soft-deleted model is restored
 * Returning false from a listener will halt the operation
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { ModelEvent } from './ModelEvent';

export class ModelRestoring<T extends Ensemble = Ensemble> extends ModelEvent<T> {
  constructor(model: T) {
    super(model);
  }
}
