/**
 * Dispatchable Concern for Jobs
 *
 * Provides static dispatch methods for Job classes.
 * Similar to the Event Dispatchable mixin, but for queue jobs.
 */

import { Facade } from '@/Support/Facade';
import { PendingDispatch } from '@/Queue/PendingDispatch';
import type { QueueManager } from '@/Queue/QueueManager';

export class JobDispatchable {
  /**
   * Dispatch the job with the given arguments
   *
   * @returns PendingDispatch for fluent configuration
   */
  static dispatch(...args: any[]): PendingDispatch {
    const app = Facade.getFacadeApplication();
    if (!app) {
      throw new Error('Application not initialized. Cannot dispatch job.');
    }

    const manager = app.make<QueueManager>('queue');
    const instance = new (this as any)(...args);
    return new PendingDispatch(manager, instance);
  }

  /**
   * Dispatch the job synchronously (bypass queue)
   */
  static async dispatchSync(...args: any[]): Promise<void> {
    const app = Facade.getFacadeApplication();
    if (!app) {
      throw new Error('Application not initialized. Cannot dispatch job.');
    }

    const manager = app.make<QueueManager>('queue');
    const instance = new (this as any)(...args);
    await manager.dispatchSync(instance);
  }

  /**
   * Dispatch the job if the given condition is true
   */
  static dispatchIf(condition: boolean | (() => boolean), ...args: any[]): PendingDispatch | null {
    const shouldDispatch = typeof condition === 'function' ? condition() : condition;

    if (shouldDispatch) {
      return this.dispatch(...args);
    }

    return null;
  }

  /**
   * Dispatch the job unless the given condition is true
   */
  static dispatchUnless(condition: boolean | (() => boolean), ...args: any[]): PendingDispatch | null {
    const shouldNotDispatch = typeof condition === 'function' ? condition() : condition;

    if (!shouldNotDispatch) {
      return this.dispatch(...args);
    }

    return null;
  }

  /**
   * Dispatch the job after the response is sent to the browser
   */
  static dispatchAfterResponse(...args: any[]): void {
    const app = Facade.getFacadeApplication();
    if (!app) {
      throw new Error('Application not initialized. Cannot dispatch job.');
    }

    const manager = app.make<QueueManager>('queue');
    const instance = new (this as any)(...args);

    // Use setImmediate/nextTick to execute after the current response
    setImmediate(async () => {
      try {
        await manager.dispatchSync(instance);
      } catch (error) {
        console.error(`[Queue] Failed to dispatch after response: ${instance.displayName()}`, error);
      }
    });
  }
}

/**
 * Apply JobDispatchable mixin to a Job class
 */
export function applyJobDispatchable(jobClass: any): void {
  const staticMethods = Object.getOwnPropertyNames(JobDispatchable);

  for (const name of staticMethods) {
    if (name === 'constructor' || name === 'prototype' || name === 'length' || name === 'name') {
      continue;
    }

    const descriptor = Object.getOwnPropertyDescriptor(JobDispatchable, name);

    if (descriptor) {
      Object.defineProperty(jobClass, name, {
        value: descriptor.value,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
  }
}
