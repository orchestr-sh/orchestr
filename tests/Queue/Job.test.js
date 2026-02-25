"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const Job_1 = require("../../src/Queue/Job");
class TestJob extends Job_1.Job {
    data;
    constructor(data = 'default') {
        super();
        this.data = data;
    }
    async handle() {
        // no-op
    }
}
class FailableJob extends Job_1.Job {
    failed = vitest_1.vi.fn();
    async handle() {
        throw new Error('Job failed');
    }
}
(0, vitest_1.describe)('Job', () => {
    (0, vitest_1.describe)('constructor', () => {
        (0, vitest_1.it)('generates a uuid', () => {
            const job = new TestJob();
            (0, vitest_1.expect)(job.uuid).toBeDefined();
            (0, vitest_1.expect)(typeof job.uuid).toBe('string');
            (0, vitest_1.expect)(job.uuid.length).toBeGreaterThan(0);
        });
        (0, vitest_1.it)('generates unique uuids', () => {
            const a = new TestJob();
            const b = new TestJob();
            (0, vitest_1.expect)(a.uuid).not.toBe(b.uuid);
        });
    });
    (0, vitest_1.describe)('defaults', () => {
        (0, vitest_1.it)('has default tries of 1', () => {
            const job = new TestJob();
            (0, vitest_1.expect)(job.tries).toBe(1);
        });
        (0, vitest_1.it)('has default timeout of 60', () => {
            const job = new TestJob();
            (0, vitest_1.expect)(job.timeout).toBe(60);
        });
        (0, vitest_1.it)('has 0 attempts initially', () => {
            const job = new TestJob();
            (0, vitest_1.expect)(job.attempts).toBe(0);
        });
        (0, vitest_1.it)('is not deleted, released, or failed initially', () => {
            const job = new TestJob();
            (0, vitest_1.expect)(job.isDeleted()).toBe(false);
            (0, vitest_1.expect)(job.isReleased()).toBe(false);
            (0, vitest_1.expect)(job.hasFailed()).toBe(false);
        });
    });
    (0, vitest_1.describe)('displayName()', () => {
        (0, vitest_1.it)('returns the class name', () => {
            const job = new TestJob();
            (0, vitest_1.expect)(job.displayName()).toBe('TestJob');
        });
    });
    (0, vitest_1.describe)('delete()', () => {
        (0, vitest_1.it)('marks job as deleted', () => {
            const job = new TestJob();
            job.delete();
            (0, vitest_1.expect)(job.isDeleted()).toBe(true);
        });
    });
    (0, vitest_1.describe)('release()', () => {
        (0, vitest_1.it)('marks job as released', () => {
            const job = new TestJob();
            job.release();
            (0, vitest_1.expect)(job.isReleased()).toBe(true);
        });
        (0, vitest_1.it)('sets release delay', () => {
            const job = new TestJob();
            job.release(30);
            (0, vitest_1.expect)(job.getReleaseDelay()).toBe(30);
        });
        (0, vitest_1.it)('defaults delay to 0', () => {
            const job = new TestJob();
            job.release();
            (0, vitest_1.expect)(job.getReleaseDelay()).toBe(0);
        });
    });
    (0, vitest_1.describe)('fail()', () => {
        (0, vitest_1.it)('marks job as failed', () => {
            const job = new TestJob();
            job.fail();
            (0, vitest_1.expect)(job.hasFailed()).toBe(true);
        });
        (0, vitest_1.it)('calls failed() hook with error', () => {
            const job = new FailableJob();
            const error = new Error('test error');
            job.fail(error);
            (0, vitest_1.expect)(job.failed).toHaveBeenCalledWith(error);
        });
    });
    (0, vitest_1.describe)('hasExceededMaxAttempts()', () => {
        (0, vitest_1.it)('returns true when attempts >= tries', () => {
            const job = new TestJob();
            job.tries = 3;
            job.attempts = 3;
            (0, vitest_1.expect)(job.hasExceededMaxAttempts()).toBe(true);
        });
        (0, vitest_1.it)('returns false when attempts < tries', () => {
            const job = new TestJob();
            job.tries = 3;
            job.attempts = 2;
            (0, vitest_1.expect)(job.hasExceededMaxAttempts()).toBe(false);
        });
        (0, vitest_1.it)('returns true when past retryUntil', () => {
            const job = new TestJob();
            job.retryUntil = new Date(Date.now() - 1000);
            (0, vitest_1.expect)(job.hasExceededMaxAttempts()).toBe(true);
        });
        (0, vitest_1.it)('returns false when before retryUntil', () => {
            const job = new TestJob();
            job.tries = undefined;
            job.retryUntil = new Date(Date.now() + 60000);
            (0, vitest_1.expect)(job.hasExceededMaxAttempts()).toBe(false);
        });
    });
    (0, vitest_1.describe)('getBackoffDelay()', () => {
        (0, vitest_1.it)('returns 0 when no backoff configured', () => {
            const job = new TestJob();
            (0, vitest_1.expect)(job.getBackoffDelay(1)).toBe(0);
        });
        (0, vitest_1.it)('returns fixed backoff when number', () => {
            const job = new TestJob();
            job.backoff = 30;
            (0, vitest_1.expect)(job.getBackoffDelay(1)).toBe(30);
            (0, vitest_1.expect)(job.getBackoffDelay(3)).toBe(30);
        });
        (0, vitest_1.it)('returns progressive backoff from array', () => {
            const job = new TestJob();
            job.backoff = [10, 30, 60];
            (0, vitest_1.expect)(job.getBackoffDelay(1)).toBe(10);
            (0, vitest_1.expect)(job.getBackoffDelay(2)).toBe(30);
            (0, vitest_1.expect)(job.getBackoffDelay(3)).toBe(60);
            // Clamps to last value
            (0, vitest_1.expect)(job.getBackoffDelay(5)).toBe(60);
        });
    });
    (0, vitest_1.describe)('serialization', () => {
        (0, vitest_1.it)('toJSON() serializes job properties', () => {
            const job = new TestJob('hello');
            const json = job.toJSON();
            (0, vitest_1.expect)(json._class).toBe('TestJob');
            (0, vitest_1.expect)(json.data).toBe('hello');
            (0, vitest_1.expect)(json.uuid).toBe(job.uuid);
        });
        (0, vitest_1.it)('toJSON() skips internal _ properties', () => {
            const job = new TestJob();
            job.delete();
            const json = job.toJSON();
            (0, vitest_1.expect)(json).not.toHaveProperty('_deleted');
            (0, vitest_1.expect)(json).not.toHaveProperty('_released');
            (0, vitest_1.expect)(json).not.toHaveProperty('_failed');
        });
        (0, vitest_1.it)('serializes Date values', () => {
            const job = new TestJob();
            const date = new Date('2024-01-01');
            job.retryUntil = date;
            const json = job.toJSON();
            (0, vitest_1.expect)(json.retryUntil).toEqual({ _type: 'Date', value: date.toISOString() });
        });
        (0, vitest_1.it)('fromJSON() restores a job', () => {
            const original = new TestJob('serialized');
            const json = original.toJSON();
            const restored = TestJob.fromJSON(json);
            (0, vitest_1.expect)(restored.data).toBe('serialized');
            (0, vitest_1.expect)(restored.uuid).toBe(original.uuid);
        });
        (0, vitest_1.it)('fromJSON() deserializes Date values', () => {
            const original = new TestJob();
            original.retryUntil = new Date('2024-06-15');
            const json = original.toJSON();
            const restored = TestJob.fromJSON(json);
            (0, vitest_1.expect)(restored.retryUntil).toBeInstanceOf(Date);
        });
    });
});
//# sourceMappingURL=Job.test.js.map