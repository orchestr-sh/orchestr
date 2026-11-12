import type { ShouldQueue } from './ShouldQueue';

/**
 * Should Queue After Commit Interface
 *
 * Marker interface for queued listeners that should only be dispatched
 * to the queue after database transactions have been committed.
 *
 * This combines the behavior of ShouldQueue with transaction awareness.
 *
 * Implementations must carry the runtime markers the dispatcher checks:
 * `queued = true` (inherited from `ShouldQueue`) and `afterCommit = true`.
 *
 * @example
 * ```typescript
 * export class SendWelcomeEmail implements ShouldQueueAfterCommit {
 *   public readonly queued = true;
 *   public readonly afterCommit = true;
 *   public tries = 3;
 *   public timeout = 30;
 *
 *   handle(event: UserRegistered): void {
 *     // This will only run if the database transaction commits
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ShouldQueueAfterCommit extends ShouldQueue {
  // Marker interface - inherits all ShouldQueue properties, requires `queued`
  // and `afterCommit` runtime markers (see ShouldQueue)
}
