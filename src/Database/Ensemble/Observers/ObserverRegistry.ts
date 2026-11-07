/**
 * Observer Registry
 *
 * Keeps model observers keyed by the model class that registered them so the
 * state is per class rather than one flat global list. Lookup walks the
 * prototype chain (parent first) so subclasses also fire the observers their
 * parents registered, matching Laravel's inheritance behaviour.
 *
 * Observers are invoked through the same `fireModelEvent` path as the event
 * dispatcher, so lifecycle ordering (saving -> creating -> created -> saved)
 * is shared by both. Halting events (`creating`, `updating`, `saving`,
 * `deleting`, `restoring`, `forceDeleting`) abort the operation when an
 * observer returns `false`.
 */

import type { Ensemble } from '../Ensemble';

/**
 * The lifecycle events an observer may implement. Mirrors Laravel's observer
 * interface, including the soft-delete hooks the SoftDeletes concern fires.
 */
export const OBSERVER_EVENTS = [
  'retrieved',
  'creating',
  'created',
  'updating',
  'updated',
  'saving',
  'saved',
  'deleting',
  'deleted',
  'softDeleting',
  'softDeleted',
  'restoring',
  'restored',
  'forceDeleting',
  'forceDeleted',
] as const;

export type ObserverEvent = (typeof OBSERVER_EVENTS)[number];

/**
 * Events whose observers can halt the operation by returning `false`.
 */
const HALTING_EVENTS: readonly string[] = ['saving', 'creating', 'updating', 'deleting', 'restoring', 'forceDeleting'];

/**
 * A single observer hook. Receives the model; may return `false` to halt a
 * halting event.
 */
export type ObserverHook = (model: any) => unknown;

/**
 * An observer object with any subset of the lifecycle hooks implemented.
 */
export type ObserverInstance = Partial<Record<ObserverEvent, ObserverHook>>;

/**
 * What `observe()` accepts: an observer class (instantiate at call time) or a
 * ready-made instance.
 */
export type ObserverRegistration = ObserverInstance | (new (...args: any[]) => ObserverInstance);

export class ObserverRegistry {
  /**
   * Observers per model class
   */
  private static observers: Map<Function, ObserverRegistration[]> = new Map();

  /**
   * Cached instances so a class observer is constructed once, mirroring
   * Laravel resolving the observer from the container and reusing it here.
   */
  private static instances: WeakMap<Function, ObserverInstance> = new WeakMap();

  /**
   * Register an observer class or instance against a model class.
   */
  static observe(modelClass: Function, observer: ObserverRegistration): void {
    const registered = this.observers.get(modelClass) ?? [];
    registered.push(observer);
    this.observers.set(modelClass, registered);
  }

  /**
   * Collect the observers that apply to a model class, base classes first.
   */
  static forModel(modelClass: Function): ObserverInstance[] {
    const chain: Function[] = [];

    let ctor: any = modelClass;
    while (typeof ctor === 'function') {
      chain.unshift(ctor);
      ctor = Object.getPrototypeOf(ctor);
    }

    const registered: ObserverRegistration[] = [];
    for (const cls of chain) {
      registered.push(...(this.observers.get(cls) ?? []));
    }

    return registered.map((observer) => this.resolve(observer));
  }

  /**
   * Fire one observer hook for a model event.
   *
   * Only hooks that are present on the observer run. Returns `false` when a
   * halting event was aborted by an observer; `true` means "continue".
   */
  static async notify(model: Ensemble, event: string): Promise<boolean> {
    const halting = HALTING_EVENTS.includes(event);

    for (const observer of this.forModel(model.constructor)) {
      const hook = (observer as any)[event];

      if (typeof hook !== 'function') {
        continue;
      }

      const result = await hook.call(observer, model);

      if (halting && result === false) {
        return false;
      }
    }

    return true;
  }

  /**
   * Forget observers: a single model class, or every class when omitted.
   */
  static clear(modelClass?: Function): void {
    if (modelClass) {
      this.observers.delete(modelClass);
    } else {
      this.observers.clear();
    }
  }

  /**
   * Materialise an observer registration: instances are used as-is, classes
   * are constructed once and cached.
   */
  private static resolve(observer: ObserverRegistration): ObserverInstance {
    if (typeof observer !== 'function') {
      return observer;
    }

    let instance = this.instances.get(observer);

    if (!instance) {
      instance = new observer();
      this.instances.set(observer, instance);
    }

    return instance;
  }
}
