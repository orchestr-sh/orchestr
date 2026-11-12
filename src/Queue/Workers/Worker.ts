/**
 * Worker
 *
 * The queue worker that processes jobs from the queue.
 * Handles the daemon loop, job processing, retries, failures,
 * memory management, and graceful shutdown.
 *
 * Mirrors Laravel's Illuminate\Queue\Worker.
 */

import type { Application } from '@/Foundation/Application';
import type { QueueDriver, QueueDriverJob } from '@/Queue/Contracts/QueueDriver';
import type { FailedJobProvider } from '@/Queue/Failed/FailedJobProvider';
import type { Job } from '@/Queue/Job';
import type { JobMiddleware } from '@/Queue/Middleware/JobMiddleware';
import type { QueueManager } from '@/Queue/QueueManager';
import type { UniqueLockToken } from '@/Queue/UniqueLock';
import { TimeoutExceededException } from '@/Queue/Exceptions/TimeoutExceededException';
import { JobPayload, type JobPayloadData } from '@/Queue/JobPayload';
import { UniqueLock } from '@/Queue/UniqueLock';
import type { WorkerOptions } from './WorkerOptions';
import { DEFAULT_WORKER_OPTIONS } from './WorkerOptions';

export class Worker {
  protected shouldQuit: boolean = false;
  protected paused: boolean = false;
  protected jobsProcessed: number = 0;
  protected startTime: number = 0;
  protected uniqueLock: UniqueLock | null = null;

  constructor(
    protected manager: QueueManager,
    protected app: Application
  ) {}

  /**
   * Run the worker daemon loop
   */
  async daemon(connectionName: string, queues: string, options: WorkerOptions = {}): Promise<void> {
    const opts = { ...DEFAULT_WORKER_OPTIONS, ...options };
    this.startTime = Date.now();

    this.listenForSignals();

    while (!this.shouldQuit) {
      // Fire looping callbacks
      this.manager.fireLoopingCallbacks();

      // Check if paused
      if (this.paused) {
        await this.sleep(opts.sleep);
        continue;
      }

      // Process the next job from the queue(s)
      const processed = await this.runNextJob(connectionName, queues, opts);

      if (!processed) {
        // No job was available
        if (opts.stopWhenEmpty) {
          this.stop();
          break;
        }
        await this.sleep(opts.sleep);
      } else {
        // Rest between jobs if configured
        if (opts.rest > 0) {
          await this.sleep(opts.rest / 1000);
        }
      }

      // Check stop conditions
      if (this.shouldStop(opts)) {
        this.stop();
      }
    }
  }

  /**
   * Process a single job (--once mode)
   */
  async runOnce(connectionName: string, queues: string, options: WorkerOptions = {}): Promise<boolean> {
    const opts = { ...DEFAULT_WORKER_OPTIONS, ...options };
    return this.runNextJob(connectionName, queues, opts);
  }

  /**
   * Get the next job and process it
   */
  async runNextJob(connectionName: string, queues: string, options: Required<WorkerOptions>): Promise<boolean> {
    const driver = this.manager.connection(connectionName);
    const queueList = queues.split(',').map((q) => q.trim());

    // Try each queue in priority order
    for (const queue of queueList) {
      const rawJob = await driver.pop(queue);

      if (rawJob) {
        await this.processJob(connectionName, driver, rawJob, options);
        this.jobsProcessed++;
        return true;
      }
    }

    return false;
  }

  /**
   * Process a single job
   */
  protected async processJob(
    connectionName: string,
    driver: QueueDriver,
    rawJob: QueueDriverJob,
    options: Required<WorkerOptions>
  ): Promise<void> {
    let payload: JobPayloadData;

    try {
      payload = JobPayload.deserialize(rawJob.payload);
    } catch (error) {
      // Invalid payload, delete the job
      console.error(`[Queue] Invalid job payload, deleting job ${rawJob.id}`);
      await driver.delete(rawJob.id);
      return;
    }

    // Resolve the job class from the registry
    const jobClass = this.manager.getJobClass(payload.job);

    if (!jobClass) {
      console.error(`[Queue] Job class [${payload.job}] not registered. Deleting job ${rawJob.id}`);
      await driver.delete(rawJob.id);
      return;
    }

    // Restore the job instance
    let job: Job;
    try {
      job = (jobClass as any).fromJSON(payload.data);
    } catch (error) {
      console.error(`[Queue] Failed to deserialize job [${payload.job}]:`, error);
      await driver.delete(rawJob.id);
      return;
    }

    // Set job metadata
    job.jobId = rawJob.id;
    job.uuid = payload.uuid;
    job.attempts = rawJob.attempts;

    // ShouldBeUniqueUntilProcessing: the lock is released as soon as the
    // job is popped, before it runs, so a new copy may be queued again.
    if (payload.uniqueUntilProcessing && payload.lockKey && payload.lockOwner) {
      await this.releaseUniqueLock({ key: payload.lockKey, owner: payload.lockOwner });
    }

    // Determine max tries
    const maxTries = job.tries ?? options.tries;

    // Fire before callbacks
    this.manager.fireBeforeCallbacks(connectionName, job);

    try {
      // Run through middleware pipeline
      await this.runJobWithMiddleware(job, options);

      // Check if the job was released back to the queue
      if (job.isReleased()) {
        await driver.release(rawJob.id, job.getReleaseDelay());
        return;
      }

      // Check if the job was explicitly deleted
      if (job.isDeleted()) {
        await driver.delete(rawJob.id);
        await this.releaseUniqueLock(this.uniqueLockTokenFor(payload));
        return;
      }

      // Job completed successfully
      await driver.delete(rawJob.id);

      // ShouldBeUnique jobs hold their lock until they finish processing
      await this.releaseUniqueLock(this.uniqueLockTokenFor(payload));

      // Fire after callbacks
      this.manager.fireAfterCallbacks(connectionName, job);
    } catch (error) {
      if (error instanceof TimeoutExceededException) {
        // The job ran past its timeout. Its cancellation signal has been
        // aborted; non-cooperative jobs keep running until the process
        // exits (see executeWithTimeout), so the job is marked failed here
        // to keep it from occupying the queue a second time.
        this.manager.fireFailingCallbacks(connectionName, job, error);
        await this.failJob(connectionName, driver, rawJob, job, payload, error);
        return;
      }

      await this.handleJobException(connectionName, driver, rawJob, job, payload, maxTries, error as Error);
    }
  }

  /**
   * Run a job through its middleware pipeline then execute it
   */
  protected async runJobWithMiddleware(job: Job, options: Required<WorkerOptions>): Promise<void> {
    const middleware: JobMiddleware[] = job.middleware?.() || [];
    const timeout = job.timeout ?? options.timeout;

    // Build middleware pipeline
    const pipeline = this.buildMiddlewarePipeline(middleware, job, async () => {
      // Execute the job with timeout
      await this.executeWithTimeout(job, timeout);
    });

    await pipeline();
  }

  /**
   * Build a middleware pipeline
   *
   * Composes the middleware around the destination so that every
   * middleware executes exactly once, in declaration order, wrapped
   * around the job: the first middleware is the outermost layer and
   * each receives the job instance and a `next` continuation that
   * invokes the following middleware (or the destination).
   */
  protected buildMiddlewarePipeline(
    middleware: JobMiddleware[],
    job: Job,
    destination: () => Promise<void>
  ): () => Promise<void> {
    return middleware.reduceRight((next: () => Promise<void>, mw: JobMiddleware) => {
      return () => mw.handle(job, next);
    }, destination);
  }

  /**
   * Execute a job with a timeout
   *
   * A cancellation signal (AbortSignal) is installed on the job and also
   * passed to `handle()`, so cooperative jobs can abort their work when the
   * timeout elapses. A JavaScript promise cannot be cancelled in-process:
   * non-cooperative jobs keep running until completion even after the
   * worker has given up on them and marked the job failed. Truly enforcing
   * timeouts (killing runaway work) requires process isolation - running
   * each job in a child process/worker thread whose timeout is enforced by
   * termination, the way Laravel's queue worker uses pcntl fork. The worker
   * here keeps the pipeline moving and marks the job failed on timeout;
   * deploy long-running or untrusted jobs on an isolated runner.
   *
   * @throws TimeoutExceededException when the deadline passes before the job resolves
   */
  protected async executeWithTimeout(job: Job, timeout: number): Promise<void> {
    if (timeout <= 0) {
      await job.handle();
      return;
    }

    const timeoutMs = timeout * 1000;
    const controller = new AbortController();

    job.setCancellationSignal(controller.signal);

    // Run handle() inside a settled promise; a late rejection after the
    // timeout must never surface as an unhandled rejection.
    let settle!: () => void;
    let rejectJob!: (error: unknown) => void;

    const jobFinished = new Promise<void>((resolve, reject) => {
      settle = resolve;
      rejectJob = reject;
    });

    Promise.resolve()
      .then(() => job.handle(controller.signal))
      .then(settle, rejectJob);

    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const timedOut = await new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), timeoutMs);
        jobFinished.then(
          () => resolve(false),
          () => resolve(false)
        );
      });

      if (timedOut) {
        // Ask cooperative jobs to stop before the failure propagates.
        controller.abort();

        throw new TimeoutExceededException(
          `Job [${job.displayName()}] has been attempted too long or run too long. The job may have previously timed out.`
        );
      }

      // Propagate job errors exactly as if handle() had been awaited
      await jobFinished;
    } finally {
      // Always clear the timeout timer so a successful (or failed) run
      // does not keep the event loop - or a stale rejection - alive.
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Handle an exception that occurred while processing a job
   */
  protected async handleJobException(
    connectionName: string,
    driver: QueueDriver,
    rawJob: QueueDriverJob,
    job: Job,
    payload: JobPayloadData,
    maxTries: number,
    error: Error
  ): Promise<void> {
    // Fire failing callbacks
    this.manager.fireFailingCallbacks(connectionName, job, error);

    // Check if the job has exceeded max attempts
    if (maxTries > 0 && rawJob.attempts >= maxTries) {
      await this.failJob(connectionName, driver, rawJob, job, payload, error);
      return;
    }

    // Check retryUntil
    if (job.retryUntil && new Date() >= job.retryUntil) {
      await this.failJob(connectionName, driver, rawJob, job, payload, error);
      return;
    }

    // Release the job back with backoff delay
    const backoffDelay = job.getBackoffDelay(rawJob.attempts);
    await driver.release(rawJob.id, backoffDelay);

    console.error(
      `[Queue] Job [${job.displayName()}] failed (attempt ${rawJob.attempts}/${maxTries || 'unlimited'}). ` +
        `Retrying in ${backoffDelay}s. Error: ${error.message}`
    );
  }

  /**
   * Mark a job as failed and store it
   */
  protected async failJob(
    connectionName: string,
    driver: QueueDriver,
    rawJob: QueueDriverJob,
    job: Job,
    payload: JobPayloadData,
    error: Error
  ): Promise<void> {
    // Delete from the queue
    await driver.delete(rawJob.id);

    // A unique job that will never run again releases its lock
    await this.releaseUniqueLock(this.uniqueLockTokenFor(payload));

    // Call the job's failed method
    if (job.failed) {
      try {
        await job.failed(error);
      } catch (failedError) {
        console.error(`[Queue] Error in failed() handler for [${job.displayName()}]:`, failedError);
      }
    }

    // Store in failed jobs table
    try {
      const failedProvider = this.getFailedJobProvider();
      if (failedProvider) {
        await failedProvider.log(connectionName, rawJob.queue, rawJob.payload, error);
      }
    } catch (storeError) {
      console.error(`[Queue] Failed to store failed job:`, storeError);
    }

    console.error(
      `[Queue] Job [${job.displayName()}] has failed after ${rawJob.attempts} attempt(s). ` + `Error: ${error.message}`
    );
  }

  /**
   * Extract the unique-lock handle stored in the payload, if any
   */
  protected uniqueLockTokenFor(payload: JobPayloadData): UniqueLockToken | null {
    if (!payload.lockKey || !payload.lockOwner) {
      return null;
    }

    return { key: payload.lockKey, owner: payload.lockOwner };
  }

  /**
   * Release a ShouldBeUnique cache lock (best effort; safe to call twice)
   */
  protected async releaseUniqueLock(token: UniqueLockToken | null): Promise<void> {
    if (!token) {
      return;
    }

    if (!this.app.bound('cache')) {
      return;
    }

    this.uniqueLock ??= new UniqueLock(this.app);

    await this.uniqueLock.release(token);
  }

  /**
   * Get the failed job provider
   */
  protected getFailedJobProvider(): FailedJobProvider | null {
    try {
      return this.app.make<FailedJobProvider>('queue.failer');
    } catch {
      return null;
    }
  }

  /**
   * Determine if the worker should stop
   */
  protected shouldStop(options: Required<WorkerOptions>): boolean {
    // Check max jobs
    if (options.maxJobs > 0 && this.jobsProcessed >= options.maxJobs) {
      return true;
    }

    // Check max time
    if (options.maxTime > 0) {
      const elapsed = (Date.now() - this.startTime) / 1000;
      if (elapsed >= options.maxTime) {
        return true;
      }
    }

    // Check memory limit
    if (this.memoryExceeded(options.memory)) {
      return true;
    }

    return false;
  }

  /**
   * Determine if the memory limit has been exceeded
   */
  protected memoryExceeded(memoryLimit: number): boolean {
    const usage = process.memoryUsage();
    const usedMB = usage.rss / 1024 / 1024;
    return usedMB >= memoryLimit;
  }

  /**
   * Sleep for the given number of seconds
   */
  protected async sleep(seconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }

  /**
   * Listen for process signals for graceful shutdown
   */
  protected listenForSignals(): void {
    process.on('SIGTERM', () => {
      this.shouldQuit = true;
    });

    process.on('SIGINT', () => {
      this.shouldQuit = true;
    });

    process.on('SIGUSR2', () => {
      // Restart signal (used by queue:restart)
      this.shouldQuit = true;
    });
  }

  /**
   * Stop the worker
   */
  stop(): void {
    this.shouldQuit = true;
  }

  /**
   * Pause the worker
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume the worker
   */
  resume(): void {
    this.paused = false;
  }

  /**
   * Get the number of jobs processed
   */
  getJobsProcessed(): number {
    return this.jobsProcessed;
  }
}
