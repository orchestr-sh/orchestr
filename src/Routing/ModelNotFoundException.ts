/**
 * ModelNotFoundException - thrown when route model binding cannot locate a record
 * Laravel: Illuminate\Database\Eloquent\ModelNotFoundException
 *
 * Thrown by the route resolver during implicit/explicit model binding when no
 * row matches the route parameter. The exception-handler ticket renders it as
 * a 404 response; until that lands the Router maps it to a plain 404 itself.
 */
export class ModelNotFoundException extends Error {
  /**
   * The model class the lookup failed against
   */
  public model?: Function;

  /**
   * The ids/values that were searched for
   */
  public ids: Array<string | number> = [];

  constructor(message: string) {
    super(message);
    this.name = 'ModelNotFoundException';

    // Keep instanceof working when the output is down-levelled
    Object.setPrototypeOf(this, ModelNotFoundException.prototype);
  }

  /**
   * Build the exception for a model class and the bindings it was missing
   * Laravel: (new ModelNotFoundException)->setModel(User::class, [$id])
   */
  static forModel(model: Function, ids: Array<string | number>): ModelNotFoundException {
    const exception = new ModelNotFoundException(
      `No query results for model [${model.name}]${ids.length > 0 ? ` ${ids.join(', ')}` : ''}`
    );
    exception.setModel(model, ids);
    return exception;
  }

  /**
   * Set the model and ids involved in the failure
   */
  setModel(model: Function, ids: Array<string | number> = []): this {
    this.model = model;
    this.ids = ids;
    return this;
  }

  /**
   * Get the model class involved in the failure
   */
  getModel(): Function | undefined {
    return this.model;
  }

  /**
   * Get the ids that could not be resolved
   */
  getIds(): Array<string | number> {
    return this.ids;
  }
}
