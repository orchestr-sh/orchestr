import { describe, it, expect, vi } from 'vitest';
import { SyncDriver } from '@/Queue/Drivers/SyncDriver';
import { NullDriver } from '@/Queue/Drivers/NullDriver';
import { Job } from '@/Queue/Job';

class TestDriverJob extends Job {
  public handled = false;
  async handle(): Promise<void> {
    this.handled = true;
  }
}

class FailingDriverJob extends Job {
  failed = vi.fn();
  async handle(): Promise<void> {
    throw new Error('fail');
  }
}

describe('SyncDriver', () => {
  const driver = new SyncDriver({ driver: 'sync', queue: 'default' });

  it('executes job immediately on push', async () => {
    const job = new TestDriverJob();
    const id = await driver.push(job);
    expect(job.handled).toBe(true);
    expect(id).toBe(job.uuid);
  });

  it('calls failed() on job error', async () => {
    const job = new FailingDriverJob();
    await expect(driver.push(job)).rejects.toThrow('fail');
    expect(job.failed).toHaveBeenCalled();
  });

  it('later() also executes immediately', async () => {
    const job = new TestDriverJob();
    const id = await driver.later(60, job);
    expect(job.handled).toBe(true);
    expect(id).toBe(job.uuid);
  });

  it('bulk() executes all jobs', async () => {
    const jobs = [new TestDriverJob(), new TestDriverJob()];
    await driver.bulk(jobs);
    expect(jobs[0].handled).toBe(true);
    expect(jobs[1].handled).toBe(true);
  });

  it('size() returns 0', async () => {
    expect(await driver.size()).toBe(0);
  });

  it('pop() returns null', async () => {
    expect(await driver.pop()).toBeNull();
  });

  it('clear() returns 0', async () => {
    expect(await driver.clear()).toBe(0);
  });

  it('pushRaw() throws', async () => {
    await expect(driver.pushRaw('payload')).rejects.toThrow();
  });

  it('manages connection name', () => {
    driver.setConnectionName('test-sync');
    expect(driver.getConnectionName()).toBe('test-sync');
  });

  it('getQueue() returns configured or default', () => {
    expect(driver.getQueue()).toBe('default');
    expect(driver.getQueue('custom')).toBe('custom');
  });
});

describe('NullDriver', () => {
  const driver = new NullDriver({ driver: 'null', queue: 'default' });

  it('push() returns uuid without executing', async () => {
    const job = new TestDriverJob();
    const id = await driver.push(job);
    expect(id).toBe(job.uuid);
    expect(job.handled).toBe(false);
  });

  it('later() returns uuid without executing', async () => {
    const job = new TestDriverJob();
    const id = await driver.later(60, job);
    expect(id).toBe(job.uuid);
    expect(job.handled).toBe(false);
  });

  it('bulk() does nothing', async () => {
    const jobs = [new TestDriverJob(), new TestDriverJob()];
    await driver.bulk(jobs);
    expect(jobs[0].handled).toBe(false);
    expect(jobs[1].handled).toBe(false);
  });

  it('size() returns 0', async () => {
    expect(await driver.size()).toBe(0);
  });

  it('pop() returns null', async () => {
    expect(await driver.pop()).toBeNull();
  });

  it('clear() returns 0', async () => {
    expect(await driver.clear()).toBe(0);
  });

  it('pushRaw() returns empty string', async () => {
    expect(await driver.pushRaw('payload')).toBe('');
  });

  it('manages connection name', () => {
    driver.setConnectionName('test-null');
    expect(driver.getConnectionName()).toBe('test-null');
  });

  it('getQueue() returns configured or default', () => {
    expect(driver.getQueue()).toBe('default');
    expect(driver.getQueue('high')).toBe('high');
  });
});
