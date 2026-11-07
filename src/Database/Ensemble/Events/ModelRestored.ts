/**
 * ModelRestored Event
 *
 * Fired after a soft-deleted model has been restored
 */

import { Ensemble } from '@/Database/Ensemble/Ensemble';
import { ModelEvent } from './ModelEvent';

export class ModelRestored<T extends Ensemble = Ensemble> extends ModelEvent<T> {
  constructor(model: T) {
    super(model);
  }
}
