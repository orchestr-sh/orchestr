/**
 * ShouldBeUnique Contract
 *
 * When a job implements this interface, the queue system will
 * ensure that only one instance of the job with the same unique
 * ID is on the queue at any given time.
 *
 * A cache lock is acquired at dispatch time using
 * `uniqueId()` as part of the lock key. If the lock cannot be
 * acquired, the dispatch is silently skipped (the job is a
 * duplicate). The lock is released when the job finishes
 * processing or permanently fails - or after `uniqueFor`
 * seconds, whichever comes first.
 *
 * Mirrors Laravel's Illuminate\Contracts\Queue\ShouldBeUnique.
 *
 * @example
 * ```typescript
 * class UpdateSearchIndex extends Job implements ShouldBeUnique {
 *   public uniqueFor = 3600; // Lock for 1 hour
 *
 *   uniqueId(): string {
 *     return `search-index-${this.productId}`;
 *   }
 * }
 * ```
 */
export interface ShouldBeUnique {
  /**
   * The unique ID used to prevent duplicate jobs
   */
  uniqueId(): string;

  /**
   * The number of seconds after which the unique lock will be released
   */
  uniqueFor?: number;
}

/**
 * ShouldBeUniqueUntilProcessing Contract
 *
 * Similar to ShouldBeUnique, but the lock is released when
 * the job is popped off the queue and starts processing rather
 * than when it completes.
 *
 * TypeScript interfaces are erased at runtime, so implementations
 * must set the `uniqueUntilProcessing` marker to `true` for the
 * queue system to detect the contract.
 *
 * Mirrors Laravel's Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing.
 *
 * @example
 * ```typescript
 * class UpdateSearchIndex extends Job implements ShouldBeUniqueUntilProcessing {
 *   public uniqueUntilProcessing: true = true;
 *
 *   uniqueId(): string {
 *     return `search-index-${this.productId}`;
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ShouldBeUniqueUntilProcessing extends ShouldBeUnique {
  /**
   * Runtime marker identifying the "until processing" variant of the
   * contract, since `implements` clauses do not survive compilation.
   */
  uniqueUntilProcessing: true;
}

/**
 * Type guard to check if a job implements ShouldBeUnique
 */
export function isShouldBeUnique(job: any): job is ShouldBeUnique {
  return job !== null && typeof job === 'object' && typeof job.uniqueId === 'function';
}

/**
 * Type guard to check if a job implements ShouldBeUniqueUntilProcessing
 */
export function isShouldBeUniqueUntilProcessing(job: any): job is ShouldBeUniqueUntilProcessing {
  return isShouldBeUnique(job) && (job as ShouldBeUniqueUntilProcessing).uniqueUntilProcessing === true;
}
