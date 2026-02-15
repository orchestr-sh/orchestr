/**
 * ModelRetrieved Event
 *
 * Fired when a model is retrieved from the database
 */

import { Ensemble } from '../Ensemble';
import { ModelEvent } from './ModelEvent';

export class ModelRetrieved<T extends Ensemble = Ensemble> extends ModelEvent<T> {
  constructor(model: T) {
    super(model);
  }
}
