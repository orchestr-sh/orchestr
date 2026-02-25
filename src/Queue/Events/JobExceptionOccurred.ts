/**
 * JobExceptionOccurred Event
 *
 * Dispatched when a job throws an exception (but may still be retried).
 */

import type { Job } from '@/Queue/Job';

export class JobExceptionOccurred {
  constructor(
    public readonly connectionName: string,
    public readonly job: Job,
    public readonly exception: Error
  ) {}
}
