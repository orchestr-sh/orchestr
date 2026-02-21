/**
 * JobQueued Event
 *
 * Dispatched when a job is pushed onto the queue.
 */

import type { Job } from '@/Queue/Job';

export class JobQueued {
  constructor(
    public readonly connectionName: string,
    public readonly queue: string,
    public readonly job: Job,
    public readonly id: string
  ) {}
}
