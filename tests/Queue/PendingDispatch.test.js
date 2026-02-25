"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const PendingDispatch_1 = require("../../src/Queue/PendingDispatch");
const Job_1 = require("../../src/Queue/Job");
const QueueManager_1 = require("../../src/Queue/QueueManager");
const NullDriver_1 = require("../../src/Queue/Drivers/NullDriver");
class PendingJob extends Job_1.Job {
    async handle() { }
}
function createManager() {
    const manager = new QueueManager_1.QueueManager({
        default: 'null',
        connections: { null: { driver: 'null', queue: 'default' } },
    });
    manager.registerDriver('null', (config) => new NullDriver_1.NullDriver(config));
    return manager;
}
(0, vitest_1.describe)('PendingDispatch', () => {
    (0, vitest_1.it)('dispatches a job', async () => {
        const manager = createManager();
        const job = new PendingJob();
        const pending = new PendingDispatch_1.PendingDispatch(manager, job);
        const id = await pending.dispatch();
        (0, vitest_1.expect)(id).toBe(job.uuid);
    });
    (0, vitest_1.it)('sets connection on the job', () => {
        const manager = createManager();
        const job = new PendingJob();
        const pending = new PendingDispatch_1.PendingDispatch(manager, job);
        pending.onConnection('redis');
        (0, vitest_1.expect)(job.connection).toBe('redis');
    });
    (0, vitest_1.it)('sets queue on the job', () => {
        const manager = createManager();
        const job = new PendingJob();
        const pending = new PendingDispatch_1.PendingDispatch(manager, job);
        pending.onQueue('high');
        (0, vitest_1.expect)(job.queue).toBe('high');
    });
    (0, vitest_1.it)('sets delay on the job', () => {
        const manager = createManager();
        const job = new PendingJob();
        const pending = new PendingDispatch_1.PendingDispatch(manager, job);
        pending.delay(60);
        (0, vitest_1.expect)(job.delay).toBe(60);
    });
    (0, vitest_1.it)('sets tries on the job', () => {
        const manager = createManager();
        const job = new PendingJob();
        const pending = new PendingDispatch_1.PendingDispatch(manager, job);
        pending.tries(5);
        (0, vitest_1.expect)(job.tries).toBe(5);
    });
    (0, vitest_1.it)('sets timeout on the job', () => {
        const manager = createManager();
        const job = new PendingJob();
        const pending = new PendingDispatch_1.PendingDispatch(manager, job);
        pending.timeout(300);
        (0, vitest_1.expect)(job.timeout).toBe(300);
    });
    (0, vitest_1.it)('sets backoff on the job', () => {
        const manager = createManager();
        const job = new PendingJob();
        const pending = new PendingDispatch_1.PendingDispatch(manager, job);
        pending.backoff([10, 30, 60]);
        (0, vitest_1.expect)(job.backoff).toEqual([10, 30, 60]);
    });
    (0, vitest_1.it)('sets afterCommit on the job', () => {
        const manager = createManager();
        const job = new PendingJob();
        const pending = new PendingDispatch_1.PendingDispatch(manager, job);
        pending.afterCommit();
        (0, vitest_1.expect)(job.afterCommit).toBe(true);
    });
    (0, vitest_1.it)('sets beforeCommit on the job', () => {
        const manager = createManager();
        const job = new PendingJob();
        const pending = new PendingDispatch_1.PendingDispatch(manager, job);
        pending.afterCommit();
        pending.beforeCommit();
        (0, vitest_1.expect)(job.afterCommit).toBe(false);
    });
    (0, vitest_1.it)('supports chaining', () => {
        const manager = createManager();
        const job = new PendingJob();
        const pending = new PendingDispatch_1.PendingDispatch(manager, job);
        const result = pending.onConnection('redis').onQueue('high').delay(30).tries(3);
        (0, vitest_1.expect)(result).toBe(pending);
    });
    (0, vitest_1.it)('is PromiseLike (can be awaited)', async () => {
        const manager = createManager();
        const job = new PendingJob();
        const pending = new PendingDispatch_1.PendingDispatch(manager, job);
        const id = await pending;
        (0, vitest_1.expect)(id).toBe(job.uuid);
    });
});
//# sourceMappingURL=PendingDispatch.test.js.map