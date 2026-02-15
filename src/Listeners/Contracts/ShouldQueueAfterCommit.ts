import type { ShouldQueue } from './ShouldQueue';

/**
 * Should Queue After Commit Interface
 *
 * Marker interface for queued listeners that should only be dispatched
 * to the queue after database transactions have been committed.
 *
 * This combines the behavior of ShouldQueue with transaction awareness.
 *
 * @example
 * ```typescript
 * export class SendWelcomeEmail implements ShouldQueueAfterCommit {
 *   public tries = 3;
 *   public timeout = 30;
 *
 *   handle(event: UserRegistered): void {
 *     // This will only run if the database transaction commits
 *   }
 * }
 * ```
 */
export interface ShouldQueueAfterCommit extends ShouldQueue {
  // Marker interface - inherits all ShouldQueue properties
}
