/**
 * Structural view of the queue subsystem the mail layer needs for
 * queued delivery. Duck-typed through the container (like the queue
 * manager's view of the database) so Mail depends on a contract, not on
 * a concrete manager (OCP).
 */

import type { Job } from '@/Queue/Job';

export interface QueueDispatcherLike {
  dispatch(job: Job): Promise<string>;
}
