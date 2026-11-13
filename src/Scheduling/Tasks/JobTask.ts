/**
 * JobTask
 *
 * Dispatches a queueable job when the scheduled Event fires. Mirrors
 * Laravel's `Schedule::job()` behaviour of pushing the job onto its
 * configured connection instead of running it inline.
 */

import type { Application } from '@/Foundation/Application';
import type { Job } from '@/Queue/Job';
import type { QueueManager } from '@/Queue/QueueManager';
import type { ScheduledTask, TaskRunOptions } from '../Contracts/ScheduledTask';

/** A Job subclass constructor, used with `Schedule.job(MyJob, args)` */
export type ScheduledJobClass = new (...args: any[]) => Job;

export class JobTask implements ScheduledTask {
  constructor(
    protected readonly app: Application | undefined,
    protected readonly job: Job | ScheduledJobClass,
    protected readonly args: any[] = []
  ) {}

  get description(): string {
    return `Job "${this.jobName()}"`;
  }

  protected jobName(): string {
    return typeof this.job === 'function' ? this.job.name : this.job.constructor.name;
  }

  /**
   * Resolve the job instance: either the object handed to `Schedule.job()`
   * or a fresh instantiation of the class with the given constructor args.
   */
  protected resolve(): Job {
    return typeof this.job === 'function' ? new this.job(...this.args) : this.job;
  }

  async run(_options?: TaskRunOptions): Promise<void> {
    if (!this.app || !this.app.bound('queue')) {
      throw new Error(
        `Scheduled job [${this.jobName()}] requires a queue manager in the container. Register the QueueServiceProvider first.`
      );
    }

    const manager = this.app.make<QueueManager>('queue');

    await manager.push(this.resolve());
  }
}
