/**
 * Dispatchable Concern
 *
 * Provides static dispatch methods for events
 * This mixin is applied to the Event base class to enable:
 * - Event.dispatch() - Dispatch immediately
 * - Event.dispatchIf() - Conditional dispatch
 * - Event.dispatchUnless() - Negative conditional dispatch
 *
 * @example
 * ```typescript
 * // Dispatch an event
 * UserRegistered.dispatch(user);
 *
 * // Conditional dispatch
 * UserRegistered.dispatchIf(shouldNotify, user);
 *
 * // Dispatch unless condition is true
 * UserRegistered.dispatchUnless(user.isAdmin, user);
 *
 * // Dispatch and wait for first response
 * const result = UserRegistered.until(user);
 * ```
 */

import type { DispatcherContract } from '@/Contracts/Events/Dispatcher';
import { Facade } from '@/Support/Facade';

/**
 * Dispatchable mixin class
 *
 * Provides static methods for dispatching events
 */
export class Dispatchable {
  /**
   * Dispatch the event with the given arguments
   *
   * Creates a new instance of the event class and dispatches it through the event dispatcher
   *
   * @param args - Constructor arguments for the event
   * @returns Array of listener responses
   *
   * @example
   * ```typescript
   * class UserRegistered extends Event {
   *   constructor(public user: User) {
   *     super();
   *   }
   * }
   *
   * // Dispatch the event
   * UserRegistered.dispatch(user);
   * ```
   */
  static dispatch(...args: any[]): any[] {
    const app = Facade.getFacadeApplication();
    if (!app) {
      throw new Error('Application not initialized. Cannot dispatch event.');
    }

    return app.make<DispatcherContract>('events').dispatch(new (this as any)(...args));
  }

  /**
   * Dispatch the event if the given condition is true
   *
   * @param condition - Boolean or function that returns boolean
   * @param args - Constructor arguments for the event
   * @returns Array of listener responses or empty array if condition is false
   *
   * @example
   * ```typescript
   * // Dispatch if condition is true
   * UserRegistered.dispatchIf(user.isActive, user);
   *
   * // Dispatch if function returns true
   * UserRegistered.dispatchIf(() => shouldNotify(), user);
   * ```
   */
  static dispatchIf(condition: boolean | (() => boolean), ...args: any[]): any[] {
    const shouldDispatch = typeof condition === 'function' ? condition() : condition;

    if (shouldDispatch) {
      return this.dispatch(...args);
    }

    return [];
  }

  /**
   * Dispatch the event unless the given condition is true
   *
   * @param condition - Boolean or function that returns boolean
   * @param args - Constructor arguments for the event
   * @returns Array of listener responses or empty array if condition is true
   *
   * @example
   * ```typescript
   * // Dispatch unless user is admin
   * UserRegistered.dispatchUnless(user.isAdmin, user);
   *
   * // Dispatch unless function returns true
   * UserRegistered.dispatchUnless(() => user.hasRole('admin'), user);
   * ```
   */
  static dispatchUnless(condition: boolean | (() => boolean), ...args: any[]): any[] {
    const shouldNotDispatch = typeof condition === 'function' ? condition() : condition;

    if (!shouldNotDispatch) {
      return this.dispatch(...args);
    }

    return [];
  }

  /**
   * Dispatch the event and call the first listener that doesn't return null
   *
   * This is useful when you want to get a response from an event listener
   *
   * @param args - Constructor arguments for the event
   * @returns First non-null listener response
   *
   * @example
   * ```typescript
   * // Get a response from the first listener
   * const result = UserRegistered.until(user);
   * if (result === false) {
   *   // Listener vetoed the operation
   * }
   * ```
   */
  static until(...args: any[]): any {
    const app = Facade.getFacadeApplication();
    if (!app) {
      throw new Error('Application not initialized. Cannot dispatch event.');
    }

    return app.make<DispatcherContract>('events').until(new (this as any)(...args));
  }
}

/**
 * Type declaration to merge Dispatchable methods into Event class
 * This enables TypeScript to understand that Event has these static methods
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Event extends Dispatchable {}

/**
 * Apply Dispatchable mixin to Event class
 *
 * This function copies all static methods from Dispatchable to the target Event class
 *
 * @param eventClass - The Event class to apply the mixin to
 *
 * @internal
 */
export function applyDispatchable(eventClass: any): void {
  // Get all static methods from Dispatchable
  const staticMethods = Object.getOwnPropertyNames(Dispatchable);

  for (const name of staticMethods) {
    // Skip constructor and prototype
    if (name === 'constructor' || name === 'prototype' || name === 'length' || name === 'name') {
      continue;
    }

    // Get the property descriptor
    const descriptor = Object.getOwnPropertyDescriptor(Dispatchable, name);

    if (descriptor) {
      // Copy the method to the event class
      Object.defineProperty(eventClass, name, {
        value: descriptor.value,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
  }
}
