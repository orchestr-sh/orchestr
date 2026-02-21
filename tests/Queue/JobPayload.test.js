"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const JobPayload_1 = require("../../src/Queue/JobPayload");
const Job_1 = require("../../src/Queue/Job");
class TestPayloadJob extends Job_1.Job {
    userId;
    tries = 3;
    timeout = 120;
    backoff = [10, 30];
    constructor(userId) {
        super();
        this.userId = userId;
    }
    async handle() { }
}
(0, vitest_1.describe)('JobPayload', () => {
    (0, vitest_1.describe)('create()', () => {
        (0, vitest_1.it)('creates payload from job', () => {
            const job = new TestPayloadJob(42);
            const payload = JobPayload_1.JobPayload.create(job);
            (0, vitest_1.expect)(payload.uuid).toBe(job.uuid);
            (0, vitest_1.expect)(payload.displayName).toBe('TestPayloadJob');
            (0, vitest_1.expect)(payload.job).toBe('TestPayloadJob');
            (0, vitest_1.expect)(payload.maxTries).toBe(3);
            (0, vitest_1.expect)(payload.timeout).toBe(120);
            (0, vitest_1.expect)(payload.backoff).toEqual([10, 30]);
            (0, vitest_1.expect)(payload.attempts).toBe(0);
            (0, vitest_1.expect)(payload.afterCommit).toBe(false);
            (0, vitest_1.expect)(payload.failOnTimeout).toBe(false);
            (0, vitest_1.expect)(payload.pushedAt).toBeDefined();
        });
        (0, vitest_1.it)('includes job data', () => {
            const job = new TestPayloadJob(42);
            const payload = JobPayload_1.JobPayload.create(job);
            (0, vitest_1.expect)(payload.data).toBeDefined();
            (0, vitest_1.expect)(payload.data._class).toBe('TestPayloadJob');
        });
        (0, vitest_1.it)('handles null optional fields', () => {
            const job = new TestPayloadJob(1);
            job.maxExceptions = undefined;
            job.retryUntil = undefined;
            const payload = JobPayload_1.JobPayload.create(job);
            (0, vitest_1.expect)(payload.maxExceptions).toBeNull();
            (0, vitest_1.expect)(payload.retryUntil).toBeNull();
        });
        (0, vitest_1.it)('serializes retryUntil as timestamp', () => {
            const job = new TestPayloadJob(1);
            const date = new Date('2024-06-15T12:00:00Z');
            job.retryUntil = date;
            const payload = JobPayload_1.JobPayload.create(job);
            (0, vitest_1.expect)(payload.retryUntil).toBe(date.getTime());
        });
    });
    (0, vitest_1.describe)('serialize() / deserialize()', () => {
        (0, vitest_1.it)('round-trips through JSON', () => {
            const job = new TestPayloadJob(42);
            const payload = JobPayload_1.JobPayload.create(job);
            const serialized = JobPayload_1.JobPayload.serialize(payload);
            const deserialized = JobPayload_1.JobPayload.deserialize(serialized);
            (0, vitest_1.expect)(deserialized.uuid).toBe(payload.uuid);
            (0, vitest_1.expect)(deserialized.displayName).toBe(payload.displayName);
            (0, vitest_1.expect)(deserialized.maxTries).toBe(payload.maxTries);
            (0, vitest_1.expect)(deserialized.timeout).toBe(payload.timeout);
        });
        (0, vitest_1.it)('serialize produces valid JSON string', () => {
            const payload = JobPayload_1.JobPayload.create(new TestPayloadJob(1));
            const serialized = JobPayload_1.JobPayload.serialize(payload);
            (0, vitest_1.expect)(() => JSON.parse(serialized)).not.toThrow();
        });
    });
});
//# sourceMappingURL=JobPayload.test.js.map