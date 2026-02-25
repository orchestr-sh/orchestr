import { describe, it, expect, vi } from 'vitest';
import { PendingDispatch } from '@/Queue/PendingDispatch';
import { Job } from '@/Queue/Job';
import { QueueManager } from '@/Queue/QueueManager';
import { NullDriver } from '@/Queue/Drivers/NullDriver';

class PendingJob extends Job {
  async handle(): Promise<void> {}
}

function createManager(): QueueManager {
  const manager = new QueueManager({
    default: 'null',
    connections: { null: { driver: 'null', queue: 'default' } },
  });
  manager.registerDriver('null', (config) => new NullDriver(config));
  return manager;
}

describe('PendingDispatch', () => {
  it('dispatches a job', async () => {
    const manager = createManager();
    const job = new PendingJob();
    const pending = new PendingDispatch(manager, job);
    const id = await pending.dispatch();
    expect(id).toBe(job.uuid);
  });

  it('sets connection on the job', () => {
    const manager = createManager();
    const job = new PendingJob();
    const pending = new PendingDispatch(manager, job);
    pending.onConnection('redis');
    expect(job.connection).toBe('redis');
  });

  it('sets queue on the job', () => {
    const manager = createManager();
    const job = new PendingJob();
    const pending = new PendingDispatch(manager, job);
    pending.onQueue('high');
    expect(job.queue).toBe('high');
  });

  it('sets delay on the job', () => {
    const manager = createManager();
    const job = new PendingJob();
    const pending = new PendingDispatch(manager, job);
    pending.delay(60);
    expect(job.delay).toBe(60);
  });

  it('sets tries on the job', () => {
    const manager = createManager();
    const job = new PendingJob();
    const pending = new PendingDispatch(manager, job);
    pending.tries(5);
    expect(job.tries).toBe(5);
  });

  it('sets timeout on the job', () => {
    const manager = createManager();
    const job = new PendingJob();
    const pending = new PendingDispatch(manager, job);
    pending.timeout(300);
    expect(job.timeout).toBe(300);
  });

  it('sets backoff on the job', () => {
    const manager = createManager();
    const job = new PendingJob();
    const pending = new PendingDispatch(manager, job);
    pending.backoff([10, 30, 60]);
    expect(job.backoff).toEqual([10, 30, 60]);
  });

  it('sets afterCommit on the job', () => {
    const manager = createManager();
    const job = new PendingJob();
    const pending = new PendingDispatch(manager, job);
    pending.afterCommit();
    expect(job.afterCommit).toBe(true);
  });

  it('sets beforeCommit on the job', () => {
    const manager = createManager();
    const job = new PendingJob();
    const pending = new PendingDispatch(manager, job);
    pending.afterCommit();
    pending.beforeCommit();
    expect(job.afterCommit).toBe(false);
  });

  it('supports chaining', () => {
    const manager = createManager();
    const job = new PendingJob();
    const pending = new PendingDispatch(manager, job);
    const result = pending.onConnection('redis').onQueue('high').delay(30).tries(3);
    expect(result).toBe(pending);
  });

  it('is PromiseLike (can be awaited)', async () => {
    const manager = createManager();
    const job = new PendingJob();
    const pending = new PendingDispatch(manager, job);
    const id = await pending;
    expect(id).toBe(job.uuid);
  });
});
