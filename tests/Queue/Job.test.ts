import { describe, it, expect, vi } from 'vitest';
import { Job } from '@/Queue/Job';

class TestJob extends Job {
  constructor(public data: string = 'default') {
    super();
  }

  async handle(): Promise<void> {
    // no-op
  }
}

class FailableJob extends Job {
  failed = vi.fn();

  async handle(): Promise<void> {
    throw new Error('Job failed');
  }
}

describe('Job', () => {
  describe('constructor', () => {
    it('generates a uuid', () => {
      const job = new TestJob();
      expect(job.uuid).toBeDefined();
      expect(typeof job.uuid).toBe('string');
      expect(job.uuid.length).toBeGreaterThan(0);
    });

    it('generates unique uuids', () => {
      const a = new TestJob();
      const b = new TestJob();
      expect(a.uuid).not.toBe(b.uuid);
    });
  });

  describe('defaults', () => {
    it('has default tries of 1', () => {
      const job = new TestJob();
      expect(job.tries).toBe(1);
    });

    it('has default timeout of 60', () => {
      const job = new TestJob();
      expect(job.timeout).toBe(60);
    });

    it('has 0 attempts initially', () => {
      const job = new TestJob();
      expect(job.attempts).toBe(0);
    });

    it('is not deleted, released, or failed initially', () => {
      const job = new TestJob();
      expect(job.isDeleted()).toBe(false);
      expect(job.isReleased()).toBe(false);
      expect(job.hasFailed()).toBe(false);
    });
  });

  describe('displayName()', () => {
    it('returns the class name', () => {
      const job = new TestJob();
      expect(job.displayName()).toBe('TestJob');
    });
  });

  describe('delete()', () => {
    it('marks job as deleted', () => {
      const job = new TestJob();
      job.delete();
      expect(job.isDeleted()).toBe(true);
    });
  });

  describe('release()', () => {
    it('marks job as released', () => {
      const job = new TestJob();
      job.release();
      expect(job.isReleased()).toBe(true);
    });

    it('sets release delay', () => {
      const job = new TestJob();
      job.release(30);
      expect(job.getReleaseDelay()).toBe(30);
    });

    it('defaults delay to 0', () => {
      const job = new TestJob();
      job.release();
      expect(job.getReleaseDelay()).toBe(0);
    });
  });

  describe('fail()', () => {
    it('marks job as failed', () => {
      const job = new TestJob();
      job.fail();
      expect(job.hasFailed()).toBe(true);
    });

    it('calls failed() hook with error', () => {
      const job = new FailableJob();
      const error = new Error('test error');
      job.fail(error);
      expect(job.failed).toHaveBeenCalledWith(error);
    });
  });

  describe('hasExceededMaxAttempts()', () => {
    it('returns true when attempts >= tries', () => {
      const job = new TestJob();
      job.tries = 3;
      job.attempts = 3;
      expect(job.hasExceededMaxAttempts()).toBe(true);
    });

    it('returns false when attempts < tries', () => {
      const job = new TestJob();
      job.tries = 3;
      job.attempts = 2;
      expect(job.hasExceededMaxAttempts()).toBe(false);
    });

    it('returns true when past retryUntil', () => {
      const job = new TestJob();
      job.retryUntil = new Date(Date.now() - 1000);
      expect(job.hasExceededMaxAttempts()).toBe(true);
    });

    it('returns false when before retryUntil', () => {
      const job = new TestJob();
      job.tries = undefined;
      job.retryUntil = new Date(Date.now() + 60000);
      expect(job.hasExceededMaxAttempts()).toBe(false);
    });
  });

  describe('getBackoffDelay()', () => {
    it('returns 0 when no backoff configured', () => {
      const job = new TestJob();
      expect(job.getBackoffDelay(1)).toBe(0);
    });

    it('returns fixed backoff when number', () => {
      const job = new TestJob();
      job.backoff = 30;
      expect(job.getBackoffDelay(1)).toBe(30);
      expect(job.getBackoffDelay(3)).toBe(30);
    });

    it('returns progressive backoff from array', () => {
      const job = new TestJob();
      job.backoff = [10, 30, 60];
      expect(job.getBackoffDelay(1)).toBe(10);
      expect(job.getBackoffDelay(2)).toBe(30);
      expect(job.getBackoffDelay(3)).toBe(60);
      // Clamps to last value
      expect(job.getBackoffDelay(5)).toBe(60);
    });
  });

  describe('serialization', () => {
    it('toJSON() serializes job properties', () => {
      const job = new TestJob('hello');
      const json = job.toJSON();
      expect(json._class).toBe('TestJob');
      expect(json.data).toBe('hello');
      expect(json.uuid).toBe(job.uuid);
    });

    it('toJSON() skips internal _ properties', () => {
      const job = new TestJob();
      job.delete();
      const json = job.toJSON();
      expect(json).not.toHaveProperty('_deleted');
      expect(json).not.toHaveProperty('_released');
      expect(json).not.toHaveProperty('_failed');
    });

    it('serializes Date values', () => {
      const job = new TestJob();
      const date = new Date('2024-01-01');
      job.retryUntil = date;
      const json = job.toJSON();
      expect(json.retryUntil).toEqual({ _type: 'Date', value: date.toISOString() });
    });

    it('fromJSON() restores a job', () => {
      const original = new TestJob('serialized');
      const json = original.toJSON();
      const restored = TestJob.fromJSON(json);
      expect(restored.data).toBe('serialized');
      expect(restored.uuid).toBe(original.uuid);
    });

    it('fromJSON() deserializes Date values', () => {
      const original = new TestJob();
      original.retryUntil = new Date('2024-06-15');
      const json = original.toJSON();
      const restored = TestJob.fromJSON(json);
      expect(restored.retryUntil).toBeInstanceOf(Date);
    });
  });
});
