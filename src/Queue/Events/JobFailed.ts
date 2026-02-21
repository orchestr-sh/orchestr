/**
 * JobFailed Event
 *
 * Dispatched when a job has failed and exceeded its maximum attempts.
 */

import type { Job } from '@/Queue/Job';

export class JobFailed {
  constructor(
    public readonly connectionName: string,
    public readonly job: Job,
    public readonly exception: Error
  ) {}
}
