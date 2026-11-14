/**
 * Observer stub. `{{ model_import }}` carries either the model import or
 * the framework's `Ensemble` base when no model was bound, so the hooks
 * always type against something the app can resolve.
 *
 * Laravel: Illuminate\Foundation\Console\ObserverMakeCommand.
 */
export default `/**
 * {{ class }}
 *
 * Namespace: {{ namespace }}
 */

{{ model_import }}

export class {{ class }} {
  /**
   * Handle the {{ model }} "created" event.
   */
  created(model: {{ model }}): void {
    //
  }

  /**
   * Handle the {{ model }} "updated" event.
   */
  updated(model: {{ model }}): void {
    //
  }

  /**
   * Handle the {{ model }} "deleted" event.
   */
  deleted(model: {{ model }}): void {
    //
  }

  /**
   * Handle the {{ model }} "restored" event.
   */
  restored(model: {{ model }}): void {
    //
  }

  /**
   * Handle the {{ model }} "forceDeleted" event.
   */
  forceDeleted(model: {{ model }}): void {
    //
  }
}
`;
