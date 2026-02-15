/**
 * Base Model Event
 *
 * Base class for all Ensemble model lifecycle events
 */

import { Ensemble } from '../Ensemble';

export abstract class ModelEvent<T extends Ensemble = Ensemble> {
  /**
   * The model instance
   */
  public model: T;

  /**
   * Create a new model event instance
   */
  constructor(model: T) {
    this.model = model;
  }
}
