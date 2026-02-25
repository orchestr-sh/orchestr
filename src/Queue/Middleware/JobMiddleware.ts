/**
 * JobMiddleware Contract
 *
 * Defines the interface for job middleware.
 * Mirrors Laravel's queue middleware pattern.
 *
 * @example
 * ```typescript
 * class RateLimited implements JobMiddleware {
 *   constructor(private key: string) {}
 *
 *   async handle(job: Job, next: () => Promise<void>): Promise<void> {
 *     // Rate limiting logic...
 *     await next();
 *   }
 * }
 * ```
 */

import type { Job } from '@/Queue/Job';

export interface JobMiddleware {
  /**
   * Process the job through this middleware
   *
   * @param job - The job being processed
   * @param next - Call to pass execution to the next middleware
   */
  handle(job: Job, next: () => Promise<void>): Promise<void>;
}
