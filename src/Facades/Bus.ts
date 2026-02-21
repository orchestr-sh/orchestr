/**
 * Bus Facade
 *
 * Provides static access to the command bus for dispatching jobs,
 * chains, and batches.
 *
 * @example
 * ```typescript
 * // Dispatch a job
 * await Bus.dispatch(new ProcessPodcast(podcastId));
 *
 * // Dispatch synchronously
 * await Bus.dispatchSync(new ProcessPodcast(podcastId));
 *
 * // Chain jobs
 * await Bus.chain([
 *   new ProcessPodcast(id),
 *   new OptimizePodcast(id),
 *   new ReleasePodcast(id),
 * ]).dispatch();
 *
 * // Batch jobs
 * const batch = await Bus.batch([
 *   new ProcessPodcast(1),
 *   new ProcessPodcast(2),
 * ])
 *   .then((batch) => console.log('Done'))
 *   .catch((batch, error) => console.error('Failed'))
 *   .dispatch();
 * ```
 */

import { Facade } from '@/Support/Facade';
import type { QueueManager } from '@/Queue/QueueManager';
import type { Job } from '@/Queue/Job';
import { PendingChain } from '@/Queue/PendingChain';
import { PendingBatch } from '@/Queue/Batching/PendingBatch';

class BusFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'queue';
  }

  /**
   * Dispatch a job to the queue
   */
  static async dispatch(job: Job): Promise<string> {
    const manager = this.getFacadeRoot() as QueueManager;
    return manager.dispatch(job);
  }

  /**
   * Dispatch a job synchronously
   */
  static async dispatchSync(job: Job): Promise<void> {
    const manager = this.getFacadeRoot() as QueueManager;
    return manager.dispatchSync(job);
  }

  /**
   * Dispatch a job immediately (alias for dispatchSync)
   */
  static async dispatchNow(job: Job): Promise<void> {
    return this.dispatchSync(job);
  }

  /**
   * Create a new chain of queueable jobs
   */
  static chain(jobs: Job[]): PendingChain {
    const manager = this.getFacadeRoot() as QueueManager;
    return new PendingChain(manager, jobs);
  }

  /**
   * Create a new batch of queueable jobs
   */
  static batch(jobs: Job[]): PendingBatch {
    const app = this.getFacadeApplication();
    return new PendingBatch(app, jobs);
  }
}

export const Bus = new Proxy(BusFacadeClass, {
  get(target, prop) {
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    try {
      const root = (target as any).getFacadeRoot() as QueueManager;
      if (root && prop in root) {
        const value = (root as any)[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(root, args);
        }
        return value;
      }
    } catch (error) {
      // Facade root not available yet
    }

    return undefined;
  },
}) as unknown as typeof BusFacadeClass & QueueManager;
