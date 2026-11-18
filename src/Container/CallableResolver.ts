import type { Container } from './Container';
import type { ParameterDescriptor } from './ParameterReflector';
import type { Abstract, CallableArgument } from './types';
import { ParameterReflector } from './ParameterReflector';

/**
 * A callable normalised for invocation: what to call, who to call it on,
 * which class should be pushed onto the container's build stack so
 * contextual bindings apply to its parameters, the reflected signature,
 * and a label for error messages.
 */
export interface NormalizedCallable {
  callback: (...args: any[]) => any;
  target?: object;
  consumer?: Abstract;
  descriptors: ParameterDescriptor[];
  label: string;
}

/**
 * Turns every `call()` input shape into a `NormalizedCallable`.
 *
 * Supported forms (Laravel's `Container::call` plus the class-string
 * shortcuts): closures and plain functions, `[Class|instance, 'method']`,
 * `'Class@method'`, `'Class'` (resolved and invoked through `__invoke` or
 * an explicit default method), and objects exposing `__invoke`.
 *
 * Class strings resolve through the container, so they must be bound or
 * aliased to a concrete - `'Controller'` works out of the box once
 * `app.bind('Controller', Controller)` ran, mirroring how the router
 * resolves string controller actions.
 */
export class CallableResolver {
  static normalize(callback: CallableArgument, container: Container, defaultMethod?: string): NormalizedCallable {
    if (typeof callback === 'string') {
      return CallableResolver.fromString(callback, container, defaultMethod);
    }

    if (Array.isArray(callback)) {
      return CallableResolver.fromTuple(callback as [Abstract | object, string], container);
    }

    if (typeof callback === 'function') {
      const fn = callback as (...args: any[]) => any;

      return {
        callback: fn,
        descriptors: ParameterReflector.closureParameters(fn),
        label: fn.name !== '' ? fn.name : 'closure',
      };
    }

    if (callback !== null && typeof callback === 'object' && typeof (callback as any).__invoke === 'function') {
      return CallableResolver.fromMethod(callback as Record<string, any>, '__invoke');
    }

    throw new Error('Container.call() expects a closure, [class|instance, method] tuple, or class string.');
  }

  private static fromString(callback: string, container: Container, defaultMethod?: string): NormalizedCallable {
    const at = callback.indexOf('@');

    if (at !== -1) {
      const [name, method] = [callback.slice(0, at), callback.slice(at + 1)];
      const instance = container.make<Record<string, any>>(name);

      return CallableResolver.fromMethod(instance, method, `${name}@${method}`);
    }

    const instance = container.make<Record<string, any>>(callback);
    const method = defaultMethod ?? (typeof instance.__invoke === 'function' ? '__invoke' : undefined);

    if (method === undefined || typeof instance[method] !== 'function') {
      throw new Error(`Target [${callback}] is not callable.`);
    }

    return CallableResolver.fromMethod(instance, method, `${callback}@${method}`);
  }

  private static fromTuple([handler, method]: [Abstract | object, string], container: Container): NormalizedCallable {
    if (typeof handler === 'function') {
      // A class: prefer prototype methods (resolve through the container
      // so constructor injection applies), fall back to statics.
      const Class = handler as any;

      if (Class.prototype && typeof Class.prototype[method] === 'function') {
        return CallableResolver.fromMethod(container.make<Record<string, any>>(handler), method);
      }

      if (typeof Class[method] === 'function') {
        return CallableResolver.fromStatic(Class, method);
      }

      throw new Error(`Method [${method}] does not exist.`);
    }

    const instance = handler as Record<string, any>;

    if (typeof instance[method] !== 'function') {
      throw new Error(`Method [${method}] does not exist.`);
    }

    return CallableResolver.fromMethod(instance, method);
  }

  /**
   * Reflect and prepare an instance method. Parameter types come from
   * `design:paramtypes` keyed by the prototype (emitted for decorated
   * methods); names and default markers are parsed from the compiled
   * signature, matching how route actions are reflected.
   */
  private static fromMethod(instance: Record<string, any>, method: string, label?: string): NormalizedCallable {
    const callback = instance[method];

    if (typeof callback !== 'function') {
      throw new Error(`Method [${method}] does not exist.`);
    }

    const prototype = Object.getPrototypeOf(instance) ?? instance;

    // Class methods reflect through the prototype (where decorator
    // metadata lives); own-property methods through the instance.
    let descriptors = ParameterReflector.methodParameters(prototype, method);

    if (descriptors.length === 0) {
      descriptors = ParameterReflector.methodParameters(instance, method);
    }

    return {
      callback,
      target: instance,
      consumer: typeof instance.constructor === 'function' ? instance.constructor : undefined,
      descriptors,
      label: label ?? `${instance.constructor?.name ?? 'Object'}.${method}`,
    };
  }

  /**
   * Reflect and prepare a static method on a class itself.
   */
  private static fromStatic(Class: any, method: string): NormalizedCallable {
    return {
      callback: Class[method],
      consumer: Class,
      descriptors: ParameterReflector.methodParameters(Class, method),
      label: `${Class.name}.${method}`,
    };
  }
}
