/**
 * JobProcessing Event
 *
 * Dispatched before a job is processed by the worker.
 */

import type { Job } from '@/Queue/Job';

export class JobProcessing {
  constructor(
    public readonly connectionName: string,
    public readonly job: Job
  ) {}
}
