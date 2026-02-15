/**
 * ModelCreated Event
 *
 * Fired after a new model is created (after insert)
 */

import { Ensemble } from '../Ensemble';
import { ModelEvent } from './ModelEvent';

export class ModelCreated<T extends Ensemble = Ensemble> extends ModelEvent<T> {
  constructor(model: T) {
    super(model);
  }
}
