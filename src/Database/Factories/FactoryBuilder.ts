/**
 * FactoryBuilder
 *
 * Relationship-aware creation engine behind Factory::make(), create() and
 * raw(). The builder takes one factory and expands its pending count into
 * individual records: models are made (with their for() parents resolved and
 * associated), afterMaking hooks run, and - for create() - each record is
 * saved together with the has() children hanging off it before afterCreating
 * hooks fire.
 *
 * SRP: the builder only orchestrates the per-record lifecycle; attribute
 * generation stays in the factory and persistence stays in the Ensemble.
 * Laravel: Illuminate\Database\Eloquent\Factories\FactoryBuilder
 */

import type { Ensemble } from '@/Database/Ensemble/Ensemble';
import type { Factory, FactoryAttributes } from './Factory';

export class FactoryBuilder<TModel extends Ensemble> {
  constructor(protected readonly factory: Factory<TModel>) {}

  /**
   * Create a new builder for the given factory.
   * Laravel: FactoryBuilder::factory()
   */
  static new<TModel extends Ensemble>(factory: Factory<TModel>): FactoryBuilder<TModel> {
    return new FactoryBuilder(factory);
  }

  /**
   * The factory this builder wraps.
   */
  getFactory(): Factory<TModel> {
    return this.factory;
  }

  /**
   * Build the pending number of unsaved models, then fire the afterMaking
   * hooks. has() children are only persisted by create() - matching the
   * current Laravel behaviour.
   */
  async make(parent?: Ensemble): Promise<TModel[]> {
    const models: TModel[] = [];

    for (let index = 0; index < this.factory.currentCount(); index++) {
      models.push(await this.factory.makeRecord(parent));
    }

    await this.factory.callAfterMaking(models);

    return models;
  }

  /**
   * Make the models, persist each one with its has() relationships, then
   * fire the afterCreating hooks.
   */
  async create(parent?: Ensemble): Promise<TModel[]> {
    const models = await this.make(parent);

    for (const model of models) {
      await this.factory.persistRecord(model, parent);
    }

    await this.factory.callAfterCreating(models, parent);

    return models;
  }

  /**
   * Evaluate the pending number of attribute arrays without ever touching
   * the Ensemble layer.
   */
  async raw(parent?: Ensemble): Promise<FactoryAttributes[]> {
    const records: FactoryAttributes[] = [];

    for (let index = 0; index < this.factory.currentCount(); index++) {
      records.push(await this.factory.buildAttributes(parent));
    }

    return records;
  }
}
