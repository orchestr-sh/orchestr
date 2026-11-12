/**
 * Should Dispatch After Commit Interface
 *
 * Marker interface for events that should only be dispatched
 * after database transactions have been committed.
 *
 * This ensures that events are only fired if database changes
 * are successfully persisted.
 *
 * TypeScript erases interfaces at compile time, so implementations must also
 * declare the runtime marker property `shouldDispatchAfterCommit` set to
 * `true`; the dispatcher defers any event carrying it until the active
 * transaction commits (and dispatches immediately outside a transaction).
 *
 * @example
 * ```typescript
 * class UserRegistered extends Event implements ShouldDispatchAfterCommit {
 *   public readonly shouldDispatchAfterCommit = true;
 *
 *   constructor(public readonly user: User) {
 *     super();
 *   }
 * }
 * ```
 */
export interface ShouldDispatchAfterCommit {
  /**
   * Runtime marker the dispatcher checks before deferring an event until the
   * active database transaction commits.
   */
  readonly shouldDispatchAfterCommit: true;
}

/**
 * Type guard checking the runtime marker of a `ShouldDispatchAfterCommit` event
 *
 * @param event - The event instance to check
 * @returns True if the event asked to be dispatched after the current commit
 */
export function isShouldDispatchAfterCommit(event: any): event is ShouldDispatchAfterCommit {
  return event !== null && typeof event === 'object' && event.shouldDispatchAfterCommit === true;
}
