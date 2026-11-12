/**
 * QueueManager
 *
 * Manages multiple queue connections and drivers.
 * Follows the same Manager pattern as DatabaseManager.
 *
 * Mirrors Laravel's Illuminate\Queue\QueueManager.
 */

import type { Container } from '@/Container/Container';
import type { QueueDriver, TransactionAwareConnection } from './Contracts/QueueDriver';
import type { Job } from './Job';
import type { Worker } from './Workers/Worker';
import type { WorkerOptions } from './Workers/WorkerOptions';
import { isShouldBeUnique } from './Contracts/ShouldBeUnique';
import { UniqueLock, type UniqueLockToken } from './UniqueLock';

/**
 * Minimal shape of a database manager used to resolve a transaction
 * connection for after-commit dispatch. Duck-typed through the container
 * so the Queue subsystem does not hard-depend on Database at import time.
 */
interface DatabaseManagerLike {
  connection(name?: string): {
    getTransactionLevel?(): number;
    afterCommit?(callback: () => any): void | Promise<void>;
  };
}

export interface QueueConnectionConfig {
  driver: string;
  connection?: string;
  table?: string;
  queue?: string;
  retry_after?: number;
  block_for?: number | null;
  after_commit?: boolean;
  [key: string]: any;
}

export interface QueueFailedConfig {
  driver: string;
  database?: string;
  table?: string;
}

export interface QueueBatchingConfig {
  database: string;
  table: string;
}

export interface QueueConfig {
  default: string;
  connections: Record<string, QueueConnectionConfig>;
  batching?: QueueBatchingConfig;
  failed?: QueueFailedConfig;
}

export type DriverFactory = (config: QueueConnectionConfig) => QueueDriver;

export class QueueManager {
  protected connections: Map<string, QueueDriver> = new Map();
  protected driverFactories: Map<string, DriverFactory> = new Map();
  protected jobRegistry: Map<string, new (...args: any[]) => Job> = new Map();
  protected uniqueLock: UniqueLock | null = null;

  /**
   * Event callbacks
   */
  protected beforeCallbacks: Array<(connectionName: string, job: Job) => void> = [];
  protected afterCallbacks: Array<(connectionName: string, job: Job) => void> = [];
  protected failingCallbacks: Array<(connectionName: string, job: Job, error: Error) => void> = [];
  protected loopingCallbacks: Array<() => void> = [];

  constructor(
    protected config: QueueConfig,
    protected container?: Container
  ) {}

  /**
   * Register a queue driver factory
   */
  registerDriver(name: string, factory: DriverFactory): void {
    this.driverFactories.set(name, factory);
  }

  /**
   * Register a job class for deserialization
   */
  registerJob(name: string, jobClass: new (...args: any[]) => Job): void {
    this.jobRegistry.set(name, jobClass);
  }

  /**
   * Get a job class from the registry
   */
  getJobClass(name: string): (new (...args: any[]) => Job) | undefined {
    return this.jobRegistry.get(name);
  }

  /**
   * Get a queue connection instance
   */
  connection(name?: string): QueueDriver {
    const connectionName = name || this.config.default;

    if (this.connections.has(connectionName)) {
      return this.connections.get(connectionName)!;
    }

    const driver = this.createConnection(connectionName);
    this.connections.set(connectionName, driver);

    return driver;
  }

  /**
   * Create a new queue connection
   */
  protected createConnection(name: string): QueueDriver {
    const config = this.config.connections[name];

    if (!config) {
      throw new Error(`Queue connection [${name}] not configured.`);
    }

    const factory = this.driverFactories.get(config.driver);

    if (!factory) {
      throw new Error(
        `Queue driver [${config.driver}] not registered. Available drivers: ${Array.from(this.driverFactories.keys()).join(', ')}`
      );
    }

    const driver = factory(config);
    driver.setConnectionName(name);

    return driver;
  }

  /**
   * Dispatch a job to its configured connection and queue
   *
   * Before the job reaches the driver this honors:
   * - ShouldBeUnique cache-lock enforcement (duplicate dispatches are skipped)
   * - after_commit deferral via the transaction system
   */
  async dispatch(job: Job): Promise<string> {
    return this.route(job, (driver) =>
      job.delay ? driver.later(job.delay, job, job.queue) : driver.push(job, job.queue)
    );
  }

  /**
   * Dispatch a job synchronously (bypass queue, execute immediately)
   */
  async dispatchSync(job: Job): Promise<void> {
    try {
      await job.handle();
    } catch (error) {
      if (job.failed) {
        await job.failed(error as Error);
      }
      throw error;
    }
  }

  /**
   * Push a job onto a specific queue
   */
  async push(job: Job, queue?: string): Promise<string> {
    return this.route(job, (driver) => driver.push(job, queue));
  }

  /**
   * Push a job onto a specific named queue
   */
  async pushOn(queue: string, job: Job): Promise<string> {
    job.queue = queue;
    return this.push(job);
  }

  /**
   * Push a job after a delay
   */
  async later(delay: number | Date, job: Job, queue?: string): Promise<string> {
    return this.route(job, (driver) => driver.later(delay, job, queue));
  }

  /**
   * Push multiple jobs onto the queue
   */
  async bulk(jobs: Job[], queue?: string): Promise<void> {
    for (const job of jobs) {
      await this.push(job, queue);
    }
  }

  /**
   * Run a job through uniqueness enforcement, after-commit deferral, and
   * the driver call. Shared by dispatch()/push()/later().
   *
   * @param job - The job being queued
   * @param call - Performs the actual driver push once allowed
   */
  protected async route(job: Job, call: (driver: QueueDriver) => Promise<string>): Promise<string> {
    const connectionName = job.connection || this.config.default;
    const driver = this.connection(connectionName);

    const token = await this.acquireUniqueLock(job);

    if (token === 'locked') {
      // Another copy of the job is already waiting on the queue; the
      // duplicate dispatch is silently skipped.
      return job.uuid;
    }

    const dispatchNow = async (): Promise<string> => {
      const id = await call(driver);

      // Inline drivers (sync) execute the job during push; no worker pops
      // the job, so the unique lock is released as soon as the push completes.
      if (token && driver.executesInline?.() === true) {
        await this.releaseUniqueLock(token);
      }

      return id;
    };

    try {
      return await this.runOrDeferUntilCommit(connectionName, driver, job, dispatchNow);
    } catch (error) {
      if (token) {
        await this.releaseUniqueLock(token);
      }
      throw error;
    }
  }

  /**
   * Acquire the ShouldBeUnique cache lock for a job when required.
   *
   * @returns The lock token, 'locked' when the dispatch is a duplicate,
   * or null when the job is not unique.
   */
  protected async acquireUniqueLock(job: Job): Promise<UniqueLockToken | 'locked' | null> {
    if (!isShouldBeUnique(job)) {
      return null;
    }

    const token = await this.uniqueLockResolver().acquire(job);

    if (token === 'not-unique') {
      return null;
    }

    if (token === 'locked') {
      return 'locked';
    }

    // Stash the lock handle on the job so JobPayload.create() embeds it in
    // the serialized envelope; the worker releases it after processing.
    (job as any)._lockKey = token.key;
    (job as any)._lockOwner = token.owner;

    return token;
  }

  /**
   * Release a previously acquired unique lock (best effort)
   */
  protected async releaseUniqueLock(token: UniqueLockToken): Promise<void> {
    if (this.container) {
      await this.uniqueLockResolver().release(token);
    }
  }

  /**
   * Lazily create the UniqueLock bound to the application container
   */
  protected uniqueLockResolver(): UniqueLock {
    if (!this.container) {
      throw new Error('ShouldBeUnique jobs require the QueueManager to be constructed with the application container.');
    }

    this.uniqueLock ??= new UniqueLock(this.container);

    return this.uniqueLock;
  }

  /**
   * Execute the push now, or defer it until the queue connection's
   * database transaction commits when `after_commit` is in effect.
   *
   * @returns The job id. When deferred, the payload uuid is returned
   * immediately; a rollback means the job is never queued.
   */
  protected async runOrDeferUntilCommit(
    connectionName: string,
    driver: QueueDriver,
    job: Job,
    dispatchNow: () => Promise<string>
  ): Promise<string> {
    const shouldDefer = job.afterCommit === true || this.getConnectionConfig(connectionName).after_commit === true;

    if (shouldDefer) {
      const connection = this.resolveTransactionConnection(driver);

      if (connection && connection.getTransactionLevel() > 0) {
        await connection.afterCommit(async () => {
          try {
            await dispatchNow();
          } catch (error) {
            console.error(`[Queue] Failed to dispatch job [${job.displayName()}] after commit:`, error);
          }
        });

        return job.uuid;
      }
    }

    return dispatchNow();
  }

  /**
   * Resolve the transaction-aware connection governing after-commit
   * dispatch: the driver's own database connection when it exposes one
   * (DatabaseDriver), otherwise the application's default db connection.
   */
  protected resolveTransactionConnection(driver: QueueDriver): TransactionAwareConnection | null {
    const fromDriver = driver.getTransactionConnection?.();

    if (
      fromDriver &&
      typeof fromDriver.getTransactionLevel === 'function' &&
      typeof fromDriver.afterCommit === 'function'
    ) {
      return fromDriver;
    }

    if (!this.container || !this.container.bound('db')) {
      return null;
    }

    try {
      const db = this.container.make<DatabaseManagerLike>('db');
      const connection = db.connection();

      if (typeof connection.getTransactionLevel !== 'function' || typeof connection.afterCommit !== 'function') {
        return null;
      }

      return connection as unknown as TransactionAwareConnection;
    } catch {
      // Database not bootable in this context; dispatch straight through
      return null;
    }
  }

  /**
   * Register a callback to be called before a job is processed
   */
  before(callback: (connectionName: string, job: Job) => void): void {
    this.beforeCallbacks.push(callback);
  }

  /**
   * Register a callback to be called after a job is processed
   */
  after(callback: (connectionName: string, job: Job) => void): void {
    this.afterCallbacks.push(callback);
  }

  /**
   * Register a callback to be called when a job fails
   */
  failing(callback: (connectionName: string, job: Job, error: Error) => void): void {
    this.failingCallbacks.push(callback);
  }

  /**
   * Register a callback to be called on each worker loop iteration
   */
  looping(callback: () => void): void {
    this.loopingCallbacks.push(callback);
  }

  /**
   * Fire the before job callbacks
   */
  fireBeforeCallbacks(connectionName: string, job: Job): void {
    for (const callback of this.beforeCallbacks) {
      callback(connectionName, job);
    }
  }

  /**
   * Fire the after job callbacks
   */
  fireAfterCallbacks(connectionName: string, job: Job): void {
    for (const callback of this.afterCallbacks) {
      callback(connectionName, job);
    }
  }

  /**
   * Fire the failing job callbacks
   */
  fireFailingCallbacks(connectionName: string, job: Job, error: Error): void {
    for (const callback of this.failingCallbacks) {
      callback(connectionName, job, error);
    }
  }

  /**
   * Fire the looping callbacks
   */
  fireLoopingCallbacks(): void {
    for (const callback of this.loopingCallbacks) {
      callback();
    }
  }

  /**
   * Disconnect from a queue connection
   */
  disconnect(name?: string): void {
    const connectionName = name || this.config.default;
    this.connections.delete(connectionName);
  }

  /**
   * Get the default connection name
   */
  getDefaultConnection(): string {
    return this.config.default;
  }

  /**
   * Set the default connection name
   */
  setDefaultConnection(name: string): void {
    this.config.default = name;
  }

  /**
   * Get all connection names
   */
  getConnections(): string[] {
    return Object.keys(this.config.connections);
  }

  /**
   * Get the queue configuration
   */
  getConfig(): QueueConfig {
    return this.config;
  }

  /**
   * Get the connection configuration
   */
  getConnectionConfig(name?: string): QueueConnectionConfig {
    const connectionName = name || this.config.default;
    const config = this.config.connections[connectionName];

    if (!config) {
      throw new Error(`Queue connection [${connectionName}] not configured.`);
    }

    return config;
  }
}
