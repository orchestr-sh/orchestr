import { describe, it, expect } from 'vitest';
import { JobPayload } from '@/Queue/JobPayload';
import { Job } from '@/Queue/Job';

class TestPayloadJob extends Job {
  public tries = 3;
  public timeout = 120;
  public backoff = [10, 30];

  constructor(public userId: number) {
    super();
  }

  async handle(): Promise<void> {}
}

describe('JobPayload', () => {
  describe('create()', () => {
    it('creates payload from job', () => {
      const job = new TestPayloadJob(42);
      const payload = JobPayload.create(job);

      expect(payload.uuid).toBe(job.uuid);
      expect(payload.displayName).toBe('TestPayloadJob');
      expect(payload.job).toBe('TestPayloadJob');
      expect(payload.maxTries).toBe(3);
      expect(payload.timeout).toBe(120);
      expect(payload.backoff).toEqual([10, 30]);
      expect(payload.attempts).toBe(0);
      expect(payload.afterCommit).toBe(false);
      expect(payload.failOnTimeout).toBe(false);
      expect(payload.pushedAt).toBeDefined();
    });

    it('includes job data', () => {
      const job = new TestPayloadJob(42);
      const payload = JobPayload.create(job);
      expect(payload.data).toBeDefined();
      expect(payload.data._class).toBe('TestPayloadJob');
    });

    it('handles null optional fields', () => {
      const job = new TestPayloadJob(1);
      job.maxExceptions = undefined;
      job.retryUntil = undefined;
      const payload = JobPayload.create(job);
      expect(payload.maxExceptions).toBeNull();
      expect(payload.retryUntil).toBeNull();
    });

    it('serializes retryUntil as timestamp', () => {
      const job = new TestPayloadJob(1);
      const date = new Date('2024-06-15T12:00:00Z');
      job.retryUntil = date;
      const payload = JobPayload.create(job);
      expect(payload.retryUntil).toBe(date.getTime());
    });
  });

  describe('serialize() / deserialize()', () => {
    it('round-trips through JSON', () => {
      const job = new TestPayloadJob(42);
      const payload = JobPayload.create(job);
      const serialized = JobPayload.serialize(payload);
      const deserialized = JobPayload.deserialize(serialized);

      expect(deserialized.uuid).toBe(payload.uuid);
      expect(deserialized.displayName).toBe(payload.displayName);
      expect(deserialized.maxTries).toBe(payload.maxTries);
      expect(deserialized.timeout).toBe(payload.timeout);
    });

    it('serialize produces valid JSON string', () => {
      const payload = JobPayload.create(new TestPayloadJob(1));
      const serialized = JobPayload.serialize(payload);
      expect(() => JSON.parse(serialized)).not.toThrow();
    });
  });
});
