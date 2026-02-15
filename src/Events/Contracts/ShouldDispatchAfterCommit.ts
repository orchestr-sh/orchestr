/**
 * Should Dispatch After Commit Interface
 *
 * Marker interface for events that should only be dispatched
 * after database transactions have been committed.
 *
 * This ensures that events are only fired if database changes
 * are successfully persisted.
 *
 * @example
 * ```typescript
 * class UserRegistered extends Event implements ShouldDispatchAfterCommit {
 *   constructor(public readonly user: User) {
 *     super();
 *   }
 * }
 * ```
 */
export interface ShouldDispatchAfterCommit {
  // Marker interface - no methods required
}
