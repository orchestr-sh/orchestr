"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const SyncDriver_1 = require("../../src/Queue/Drivers/SyncDriver");
const NullDriver_1 = require("../../src/Queue/Drivers/NullDriver");
const Job_1 = require("../../src/Queue/Job");
class TestDriverJob extends Job_1.Job {
    handled = false;
    async handle() {
        this.handled = true;
    }
}
class FailingDriverJob extends Job_1.Job {
    failed = vitest_1.vi.fn();
    async handle() {
        throw new Error('fail');
    }
}
(0, vitest_1.describe)('SyncDriver', () => {
    const driver = new SyncDriver_1.SyncDriver({ driver: 'sync', queue: 'default' });
    (0, vitest_1.it)('executes job immediately on push', async () => {
        const job = new TestDriverJob();
        const id = await driver.push(job);
        (0, vitest_1.expect)(job.handled).toBe(true);
        (0, vitest_1.expect)(id).toBe(job.uuid);
    });
    (0, vitest_1.it)('calls failed() on job error', async () => {
        const job = new FailingDriverJob();
        await (0, vitest_1.expect)(driver.push(job)).rejects.toThrow('fail');
        (0, vitest_1.expect)(job.failed).toHaveBeenCalled();
    });
    (0, vitest_1.it)('later() also executes immediately', async () => {
        const job = new TestDriverJob();
        const id = await driver.later(60, job);
        (0, vitest_1.expect)(job.handled).toBe(true);
        (0, vitest_1.expect)(id).toBe(job.uuid);
    });
    (0, vitest_1.it)('bulk() executes all jobs', async () => {
        const jobs = [new TestDriverJob(), new TestDriverJob()];
        await driver.bulk(jobs);
        (0, vitest_1.expect)(jobs[0].handled).toBe(true);
        (0, vitest_1.expect)(jobs[1].handled).toBe(true);
    });
    (0, vitest_1.it)('size() returns 0', async () => {
        (0, vitest_1.expect)(await driver.size()).toBe(0);
    });
    (0, vitest_1.it)('pop() returns null', async () => {
        (0, vitest_1.expect)(await driver.pop()).toBeNull();
    });
    (0, vitest_1.it)('clear() returns 0', async () => {
        (0, vitest_1.expect)(await driver.clear()).toBe(0);
    });
    (0, vitest_1.it)('pushRaw() throws', async () => {
        await (0, vitest_1.expect)(driver.pushRaw('payload')).rejects.toThrow();
    });
    (0, vitest_1.it)('manages connection name', () => {
        driver.setConnectionName('test-sync');
        (0, vitest_1.expect)(driver.getConnectionName()).toBe('test-sync');
    });
    (0, vitest_1.it)('getQueue() returns configured or default', () => {
        (0, vitest_1.expect)(driver.getQueue()).toBe('default');
        (0, vitest_1.expect)(driver.getQueue('custom')).toBe('custom');
    });
});
(0, vitest_1.describe)('NullDriver', () => {
    const driver = new NullDriver_1.NullDriver({ driver: 'null', queue: 'default' });
    (0, vitest_1.it)('push() returns uuid without executing', async () => {
        const job = new TestDriverJob();
        const id = await driver.push(job);
        (0, vitest_1.expect)(id).toBe(job.uuid);
        (0, vitest_1.expect)(job.handled).toBe(false);
    });
    (0, vitest_1.it)('later() returns uuid without executing', async () => {
        const job = new TestDriverJob();
        const id = await driver.later(60, job);
        (0, vitest_1.expect)(id).toBe(job.uuid);
        (0, vitest_1.expect)(job.handled).toBe(false);
    });
    (0, vitest_1.it)('bulk() does nothing', async () => {
        const jobs = [new TestDriverJob(), new TestDriverJob()];
        await driver.bulk(jobs);
        (0, vitest_1.expect)(jobs[0].handled).toBe(false);
        (0, vitest_1.expect)(jobs[1].handled).toBe(false);
    });
    (0, vitest_1.it)('size() returns 0', async () => {
        (0, vitest_1.expect)(await driver.size()).toBe(0);
    });
    (0, vitest_1.it)('pop() returns null', async () => {
        (0, vitest_1.expect)(await driver.pop()).toBeNull();
    });
    (0, vitest_1.it)('clear() returns 0', async () => {
        (0, vitest_1.expect)(await driver.clear()).toBe(0);
    });
    (0, vitest_1.it)('pushRaw() returns empty string', async () => {
        (0, vitest_1.expect)(await driver.pushRaw('payload')).toBe('');
    });
    (0, vitest_1.it)('manages connection name', () => {
        driver.setConnectionName('test-null');
        (0, vitest_1.expect)(driver.getConnectionName()).toBe('test-null');
    });
    (0, vitest_1.it)('getQueue() returns configured or default', () => {
        (0, vitest_1.expect)(driver.getQueue()).toBe('default');
        (0, vitest_1.expect)(driver.getQueue('high')).toBe('high');
    });
});
//# sourceMappingURL=Drivers.test.js.map