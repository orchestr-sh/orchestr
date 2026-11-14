/**
 * Policy stub - the resource ability methods Laravel's gate conventions
 * expect. With `--model`, `{{ model_import }}` and `{{ model_arg }}` bind
 * the model verbs to the model instance being checked.
 *
 * Laravel: Illuminate\Foundation\Console\PolicyMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

import { Policy } from '@orchestr-sh/orchestr';
import type { Authenticatable } from '@orchestr-sh/orchestr';

{{ model_import }}

export class {{ class }} extends Policy {
  /**
   * Determine whether the user can view any models.
   */
  viewAny(user: Authenticatable): boolean {
    return false;
  }

  /**
   * Determine whether the user can view the model.
   */
  view(user: Authenticatable{{ model_arg }}): boolean {
    return false;
  }

  /**
   * Determine whether the user can create models.
   */
  create(user: Authenticatable): boolean {
    return false;
  }

  /**
   * Determine whether the user can update the model.
   */
  update(user: Authenticatable{{ model_arg }}): boolean {
    return false;
  }

  /**
   * Determine whether the user can delete the model.
   */
  delete(user: Authenticatable{{ model_arg }}): boolean {
    return false;
  }

  /**
   * Determine whether the user can restore the model.
   */
  restore(user: Authenticatable{{ model_arg }}): boolean {
    return false;
  }

  /**
   * Determine whether the user can permanently delete the model.
   */
  forceDelete(user: Authenticatable{{ model_arg }}): boolean {
    return false;
  }
}
`;
