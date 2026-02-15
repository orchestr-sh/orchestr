/**
 * ModelDeleting Event
 *
 * Fired before a model is deleted
 * Returning false from a listener will halt the operation
 */

import { Ensemble } from '../Ensemble';
import { ModelEvent } from './ModelEvent';

export class ModelDeleting<T extends Ensemble = Ensemble> extends ModelEvent<T> {
  constructor(model: T) {
    super(model);
  }
}
