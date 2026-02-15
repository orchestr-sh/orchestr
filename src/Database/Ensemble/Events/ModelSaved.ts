/**
 * ModelSaved Event
 *
 * Fired after a model is saved (after insert or update)
 */

import { Ensemble } from '../Ensemble';
import { ModelEvent } from './ModelEvent';

export class ModelSaved<T extends Ensemble = Ensemble> extends ModelEvent<T> {
  constructor(model: T) {
    super(model);
  }
}
