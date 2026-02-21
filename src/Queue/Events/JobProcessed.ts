/**
 * JobProcessed Event
 *
 * Dispatched after a job has been successfully processed.
 */

import type { Job } from '@/Queue/Job';

export class JobProcessed {
  constructor(
    public readonly connectionName: string,
    public readonly job: Job
  ) {}
}
