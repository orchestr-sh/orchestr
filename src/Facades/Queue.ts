/**
 * Queue Facade
 *
 * Provides static access to the queue manager for dispatching
 * and managing queued jobs.
 *
 * @example
 * ```typescript
 * // Push a job onto the queue
 * await Queue.push(new ProcessPodcast(podcastId));
 *
 * // Push onto a specific queue
 * await Queue.pushOn('high-priority', new ProcessPodcast(podcastId));
 *
 * // Push with a delay
 * await Queue.later(60, new ProcessPodcast(podcastId));
 *
 * // Get queue size
 * const size = await Queue.size();
 *
 * // Event hooks
 * Queue.before((connectionName, job) => {
 *   console.log('Processing:', job.displayName());
 * });
 *
 * Queue.after((connectionName, job) => {
 *   console.log('Processed:', job.displayName());
 * });
 *
 * Queue.failing((connectionName, job, error) => {
 *   console.error('Failed:', job.displayName(), error);
 * });
 * ```
 */

import { Facade } from '@/Support/Facade';
import type { QueueManager } from '@/Queue/QueueManager';

class QueueFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'queue';
  }
}

export const Queue = new Proxy(QueueFacadeClass, {
  get(target, prop) {
    // First check if it's a static method on the facade class itself
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    // Then try to get from the facade root (the QueueManager instance)
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
}) as unknown as typeof QueueFacadeClass & QueueManager;
