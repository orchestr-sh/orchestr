/**
 * QueueFake
 *
 * Test double for the queue manager. Installed with `Queue.fake()` it
 * records every dispatched job instead of sending it to a real driver,
 * and offers Laravel-style assertions:
 *
 * @example
 * ```typescript
 * const queue = Queue.fake();
 *
 * await ProcessPodcast.dispatch(1);
 *
 * queue.assertPushed(ProcessPodcast);
 * queue.assertPushedOn('default', ProcessPodcast);
 * queue.assertNotPushed(OptimizePodcast);
 * queue.assertNothingPushed(); // throws - one job was pushed
 * ```
 *
 * Chain and batch metadata recorded by `Bus.chain()` / `Bus.batch()`
 * (`_chainJobs` on the first job, `_batchId` on each job) is captured at
 * push time so `assertPushedWithChain` / `assertPushedWithBatch` work the
 * same way as in Laravel.
 */

import type { QueueDriver, QueueDriverJob } from '@/Queue/Contracts/QueueDriver';
import type { Job } from '@/Queue/Job';
import type { JobClass } from '@/Queue/Job';

/**
 * A single recorded dispatch
 */
export interface PushedJobRecord {
  /** The job instance that was pushed */
  job: Job;

  /** Connection the job was dispatched on */
  connection: string;

  /** Queue the job was pushed onto */
  queue: string;

  /** Delay requested at dispatch time (seconds or Date), if any */
  delay: number | Date | null;

  /** Display names of the remaining chain jobs, when dispatched via a chain */
  chain: string[];

  /** Batch id, when dispatched via a batch */
  batchId: string | null;

  /** Timestamp of the recorded push */
  pushedAt: number;
}

type JobMatcher = string | JobClass | Job | (new (...args: any[]) => Job);

export class QueueFake implements QueueDriver {
  /**
   * Every job recorded by this fake, in push order
   */
  public pushedJobs: PushedJobRecord[] = [];

  protected connectionName: string;
  protected defaultQueue: string;

  constructor(options: { connection?: string; queue?: string } = {}) {
    this.connectionName = options.connection ?? 'sync';
    this.defaultQueue = options.queue ?? 'default';
  }

  // ==================== QueueManager surface ====================

  /**
   * Dispatch a job to its configured connection/queue (recorded only)
   */
  async dispatch(job: Job): Promise<string> {
    if (job.delay) {
      return this.later(job.delay, job, job.queue);
    }

    return this.push(job, job.queue);
  }

  /**
   * Dispatch a job synchronously; the fake records it without executing
   */
  async dispatchSync(job: Job): Promise<void> {
    await this.push(job, job.queue);
  }

  /**
   * Connections resolve to the fake itself so code calling
   * `Queue.connection(...).push(...)` is still recorded.
   */
  connection(_name?: string): QueueDriver {
    return this;
  }

  /**
   * Job class registry no-ops; nothing is ever resolved from a fake queue
   */
  registerJob(_name: string, _jobClass: new (...args: any[]) => Job): void {
    // recorded jobs are inspected directly
  }

  getJobClass(_name: string): (new (...args: any[]) => Job) | undefined {
    return undefined;
  }

  getDefaultConnection(): string {
    return this.connectionName;
  }

  setDefaultConnection(name: string): void {
    this.connectionName = name;
  }

  before(_callback: (connectionName: string, job: Job) => void): void {
    // no lifecycle callbacks run against fakes
  }

  after(_callback: (connectionName: string, job: Job) => void): void {
    // no lifecycle callbacks run against fakes
  }

  failing(_callback: (connectionName: string, job: Job, error: Error) => void): void {
    // no lifecycle callbacks run against fakes
  }

  looping(_callback: () => void): void {
    // no lifecycle callbacks run against fakes
  }

  // ==================== QueueDriver surface ====================

  async push(job: Job, queue?: string): Promise<string> {
    this.pushedJobs.push({
      job,
      connection: job.connection ?? this.connectionName,
      queue: queue ?? job.queue ?? this.defaultQueue,
      delay: job.delay ?? null,
      chain: this.extractChain(job),
      batchId: this.extractBatchId(job),
      pushedAt: Date.now(),
    });

    return job.uuid;
  }

  async pushRaw(_payload: string, _queue?: string, _options?: Record<string, any>): Promise<string> {
    return '';
  }

  async later(delay: number | Date, job: Job, queue?: string): Promise<string> {
    job.delay = delay;
    const id = await this.push(job, queue);

    // Replace the auto-captured delay with the explicit one
    this.pushedJobs[this.pushedJobs.length - 1].delay = delay;

    return id;
  }

  async pushOn(queue: string, job: Job): Promise<string> {
    job.queue = queue;
    return this.push(job, queue);
  }

  async bulk(jobs: Job[], queue?: string): Promise<void> {
    for (const job of jobs) {
      await this.push(job, queue);
    }
  }

  async size(queue?: string): Promise<number> {
    const queueName = queue ?? this.defaultQueue;
    return this.pushedJobs.filter((record) => record.queue === queueName).length;
  }

  async pop(_queue?: string): Promise<QueueDriverJob | null> {
    return null;
  }

  async release(_id: string, _delay?: number): Promise<void> {
    // no-op on a fake queue
  }

  async delete(_id: string): Promise<void> {
    // no-op on a fake queue
  }

  async clear(queue?: string): Promise<number> {
    const queueName = queue ?? this.defaultQueue;
    const before = this.pushedJobs.length;

    this.pushedJobs = this.pushedJobs.filter((record) => record.queue !== queueName);

    return before - this.pushedJobs.length;
  }

  getConnectionName(): string {
    return this.connectionName;
  }

  setConnectionName(name: string): void {
    this.connectionName = name;
  }

  getQueue(queue?: string): string {
    return queue || this.defaultQueue;
  }

  // ==================== Inspection helpers ====================

  /**
   * Get all records matching a job class, name, or instance
   */
  records(job?: JobMatcher): PushedJobRecord[] {
    if (job === undefined) {
      return [...this.pushedJobs];
    }

    return this.pushedJobs.filter((record) => this.matches(record.job, job));
  }

  /**
   * Get the job instances matching a job class, name, or instance
   */
  pushed(job: JobMatcher): Job[] {
    return this.records(job).map((record) => record.job);
  }

  /**
   * Determine whether a pushed job matches a class/name/instance matcher
   */
  protected matches(pushed: Job, matcher: JobMatcher): boolean {
    if (matcher instanceof Object && typeof (matcher as any).handle === 'function' && !(matcher as any).prototype) {
      // an instance: identity first, then constructor name
      if (pushed === matcher) {
        return true;
      }

      return pushed.constructor.name === matcher.constructor.name;
    }

    if (typeof matcher === 'string') {
      return pushed.constructor.name === matcher || pushed.displayName() === matcher;
    }

    // a class constructor
    return pushed instanceof (matcher as new (...args: any[]) => Job);
  }

  /**
   * Read chain metadata stashed on the job by PendingChain
   */
  protected extractChain(job: Job): string[] {
    const chained = (job as any)._chainJobs;

    if (!Array.isArray(chained)) {
      return [];
    }

    return chained.map((entry: any) => (typeof entry === 'string' ? entry : entry.class));
  }

  /**
   * Read batch metadata stashed on the job by PendingBatch
   */
  protected extractBatchId(job: Job): string | null {
    return (job as any)._batchId ?? null;
  }

  protected describe(matcher: JobMatcher): string {
    if (typeof matcher === 'string') {
      return matcher;
    }

    if (matcher instanceof Object && typeof (matcher as any).handle === 'function' && !(matcher as any).prototype) {
      return matcher.constructor.name;
    }

    const name = (matcher as any).name;

    return typeof name === 'string' && name.length > 0 ? name : '<anonymous job>';
  }

  protected summary(): string {
    if (this.pushedJobs.length === 0) {
      return 'none were pushed';
    }

    return (
      'pushed jobs: ' +
      this.pushedJobs
        .map((record) => `${record.job.constructor.name} on ${record.connection}:${record.queue}`)
        .join(', ')
    );
  }

  // ==================== Assertions ====================

  /**
   * Assert a job was pushed onto the fake queue
   *
   * @param job - Job class, instance, or display name
   * @param callback - Optional predicate the recorded job must satisfy
   */
  assertPushed(job: JobMatcher, callback?: (job: Job) => boolean): void {
    const records = this.records(job);

    if (records.length === 0) {
      throw new Error(`Job [${this.describe(job)}] was not pushed.\n${this.summary()}`);
    }

    if (callback && !records.some((record) => callback(record.job))) {
      throw new Error(
        `Job [${this.describe(job)}] was pushed ${records.length} time(s) but none matched the callback.`
      );
    }
  }

  /**
   * Assert a job was NOT pushed onto the fake queue
   */
  assertNotPushed(job: JobMatcher, callback?: (job: Job) => boolean): void {
    const records = this.records(job);

    if (records.length === 0) {
      return;
    }

    if (!callback) {
      throw new Error(`Job [${this.describe(job)}] was pushed ${records.length} time(s), but expected it not to be.`);
    }

    if (records.some((record) => callback(record.job))) {
      throw new Error(`Job [${this.describe(job)}] was unexpectedly pushed matching the provided callback.`);
    }
  }

  /**
   * Assert a job was pushed onto a specific named queue
   */
  assertPushedOn(queue: string, job: JobMatcher, callback?: (job: Job) => boolean): void {
    const records = this.records(job).filter((record) => record.queue === queue);

    if (records.length === 0) {
      const onQueue = this.pushedJobs
        .filter((record) => record.queue === queue)
        .map((record) => record.job.constructor.name)
        .join(', ');

      throw new Error(
        `Job [${this.describe(job)}] was not pushed on queue [${queue}]. ` +
          `Jobs on that queue: ${onQueue || 'none'}. ${this.summary()}`
      );
    }

    if (callback && !records.some((record) => callback(record.job))) {
      throw new Error(
        `Job [${this.describe(job)}] was pushed on queue [${queue}] ${records.length} time(s) ` +
          'but none matched the callback.'
      );
    }
  }

  /**
   * Assert a job was pushed a specific number of times
   */
  assertPushedTimes(job: JobMatcher, times: number): void {
    const count = this.records(job).length;

    if (count !== times) {
      throw new Error(`Job [${this.describe(job)}] was pushed ${count} time(s) instead of ${times}.`);
    }
  }

  /**
   * Assert nothing at all was pushed onto the fake queue
   */
  assertNothingPushed(): void {
    if (this.pushedJobs.length > 0) {
      throw new Error(`Expected no jobs to be pushed, but ${this.pushedJobs.length} were. ${this.summary()}`);
    }
  }

  /**
   * Assert a job was pushed as part of a chain
   *
   * @param job - The first job of the chain
   * @param chain - Optional expected list of remaining job class names,
   *                in execution order. When provided, the recorded chain
   *                must match exactly.
   */
  assertPushedWithChain(job: JobMatcher, chain: string[] = []): void {
    const records = this.records(job).filter((record) => record.chain.length > 0);

    if (records.length === 0) {
      throw new Error(`Job [${this.describe(job)}] was not pushed as part of a chain.\n${this.summary()}`);
    }

    if (chain.length === 0) {
      return;
    }

    const matches = records.some((record) => JSON.stringify(record.chain) === JSON.stringify(chain));

    if (!matches) {
      const actual = records.map((record) => record.chain.join(', ')).join(' | ');
      throw new Error(
        `Job [${this.describe(job)}] was not pushed with the expected chain. ` +
          `Expected: [${chain.join(', ')}], got: [${actual}]`
      );
    }
  }

  /**
   * Assert a job was pushed without any chain attached
   */
  assertPushedWithoutChain(job: JobMatcher): void {
    const records = this.records(job);

    if (records.length === 0) {
      throw new Error(`Job [${this.describe(job)}] was not pushed.\n${this.summary()}`);
    }

    if (records.every((record) => record.chain.length > 0)) {
      throw new Error(`Job [${this.describe(job)}] was pushed with a chain, but none was expected.`);
    }
  }

  /**
   * Assert a job was pushed as part of a batch
   *
   * @param job - The batched job
   * @param batchId - Optional exact batch id to match
   */
  assertPushedWithBatch(job: JobMatcher, batchId?: string): void {
    const records = this.records(job);

    if (batchId === undefined) {
      if (records.some((record) => record.batchId !== null)) {
        return;
      }

      throw new Error(`Job [${this.describe(job)}] was not pushed as part of a batch.\n${this.summary()}`);
    }

    if (!records.some((record) => record.batchId === batchId)) {
      const actual = records.map((record) => record.batchId ?? 'none').join(', ');
      throw new Error(
        `Job [${this.describe(job)}] was not pushed with batch [${batchId}]. ` + `Batch ids on record: ${actual}.`
      );
    }
  }

  /**
   * Clear all recorded pushes (useful between test cases)
   *
   * Named `reset` (not `clear`) to avoid colliding with the QueueDriver
   * contract's clear() implemented above.
   */
  reset(): void {
    this.pushedJobs = [];
  }
}
