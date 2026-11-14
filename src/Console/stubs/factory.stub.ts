/**
 * Model factory stub, rendered when the factory's model is known. Node has
 * no autoload-by-namespace, so the generated file pairs the factory with
 * its model through `registerFactory()` the way HasFactory documents.
 *
 * Laravel: Illuminate\Foundation\Console\FactoryMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

import { Factory, registerFactory } from '@orchestr-sh/orchestr';
import type { FactoryAttributes } from '@orchestr-sh/orchestr';

{{ model_import }}

export class {{ class }} extends Factory<{{ model }}> {
  /**
   * The model the factory creates.
   */
  static model = {{ model }};

  /**
   * The model's default attribute state.
   */
  definition(): FactoryAttributes {
    return {
      // Example - import { fake } from '@orchestr-sh/orchestr' to use fakes:
      // title: fake('lorem.sentence'),
    };
  }
}

registerFactory({{ class }});
`;
