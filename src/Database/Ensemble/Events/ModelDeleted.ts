/**
 * ModelDeleted Event
 *
 * Fired after a model is deleted
 */

import { Ensemble } from '../Ensemble';
import { ModelEvent } from './ModelEvent';

export class ModelDeleted<T extends Ensemble = Ensemble> extends ModelEvent<T> {
  constructor(model: T) {
    super(model);
  }
}
