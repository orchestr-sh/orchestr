/**
 * Factory stub for names whose model cannot be resolved from the naming
 * convention: the pairing with a model class is left as a commented
 * `registerFactory()` call instead of an import that would not compile.
 *
 * Laravel: Illuminate\Foundation\Console\FactoryMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

import { Ensemble, Factory } from '@orchestr-sh/orchestr';
import type { FactoryAttributes } from '@orchestr-sh/orchestr';

export class {{ class }} extends Factory<Ensemble> {
  /**
   * The model's default attribute state.
   */
  definition(): FactoryAttributes {
    return {
      //
    };
  }
}

// Pair the factory with its model so Model.factory() resolves it by
// convention: registerFactory({{ class }}, YourModel);
`;
