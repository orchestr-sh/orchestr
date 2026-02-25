"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const QueueManager_1 = require("../../src/Queue/QueueManager");
const NullDriver_1 = require("../../src/Queue/Drivers/NullDriver");
const SyncDriver_1 = require("../../src/Queue/Drivers/SyncDriver");
const Job_1 = require("../../src/Queue/Job");
class SimpleJob extends Job_1.Job {
    handled = false;
    async handle() {
        this.handled = true;
    }
}
class FailingJob extends Job_1.Job {
    failed = vitest_1.vi.fn();
    async handle() {
        throw new Error('Intentional failure');
    }
}
(0, vitest_1.describe)('QueueManager', () => {
    let manager;
    (0, vitest_1.beforeEach)(() => {
        manager = new QueueManager_1.QueueManager({
            default: 'sync',
            connections: {
                sync: { driver: 'sync', queue: 'default' },
                null: { driver: 'null', queue: 'default' },
            },
        });
        manager.registerDriver('sync', (config) => new SyncDriver_1.SyncDriver(config));
        manager.registerDriver('null', (config) => new NullDriver_1.NullDriver(config));
    });
    (0, vitest_1.describe)('connection()', () => {
        (0, vitest_1.it)('returns default connection', () => {
            const driver = manager.connection();
            (0, vitest_1.expect)(driver).toBeDefined();
        });
        (0, vitest_1.it)('returns named connection', () => {
            const driver = manager.connection('null');
            (0, vitest_1.expect)(driver).toBeDefined();
        });
        (0, vitest_1.it)('caches connections', () => {
            const a = manager.connection();
            const b = manager.connection();
            (0, vitest_1.expect)(a).toBe(b);
        });
        (0, vitest_1.it)('throws for unconfigured connection', () => {
            (0, vitest_1.expect)(() => manager.connection('redis')).toThrow('not configured');
        });
        (0, vitest_1.it)('throws for unregistered driver', () => {
            const mgr = new QueueManager_1.QueueManager({
                default: 'custom',
                connections: { custom: { driver: 'custom' } },
            });
            (0, vitest_1.expect)(() => mgr.connection()).toThrow('not registered');
        });
    });
    (0, vitest_1.describe)('registerDriver()', () => {
        (0, vitest_1.it)('registers a new driver factory', () => {
            manager.registerDriver('custom', (config) => new NullDriver_1.NullDriver(config));
            const mgr = new QueueManager_1.QueueManager({
                default: 'test',
                connections: { test: { driver: 'custom' } },
            });
            mgr.registerDriver('custom', (config) => new NullDriver_1.NullDriver(config));
            (0, vitest_1.expect)(mgr.connection()).toBeDefined();
        });
    });
    (0, vitest_1.describe)('registerJob() / getJobClass()', () => {
        (0, vitest_1.it)('registers and retrieves job classes', () => {
            manager.registerJob('SimpleJob', SimpleJob);
            (0, vitest_1.expect)(manager.getJobClass('SimpleJob')).toBe(SimpleJob);
        });
        (0, vitest_1.it)('returns undefined for unregistered jobs', () => {
            (0, vitest_1.expect)(manager.getJobClass('Unknown')).toBeUndefined();
        });
    });
    (0, vitest_1.describe)('dispatch()', () => {
        (0, vitest_1.it)('dispatches a job to the queue', async () => {
            const job = new SimpleJob();
            const id = await manager.dispatch(job);
            (0, vitest_1.expect)(id).toBe(job.uuid);
            (0, vitest_1.expect)(job.handled).toBe(true); // sync driver executes immediately
        });
        (0, vitest_1.it)('uses job connection if set', async () => {
            const job = new SimpleJob();
            job.connection = 'null';
            const id = await manager.dispatch(job);
            (0, vitest_1.expect)(id).toBe(job.uuid);
            (0, vitest_1.expect)(job.handled).toBe(false); // null driver doesn't execute
        });
        (0, vitest_1.it)('uses later() when delay is set', async () => {
            const job = new SimpleJob();
            job.delay = 60;
            const id = await manager.dispatch(job);
            (0, vitest_1.expect)(id).toBe(job.uuid);
        });
    });
    (0, vitest_1.describe)('dispatchSync()', () => {
        (0, vitest_1.it)('executes job immediately', async () => {
            const job = new SimpleJob();
            await manager.dispatchSync(job);
            (0, vitest_1.expect)(job.handled).toBe(true);
        });
        (0, vitest_1.it)('calls failed() on error', async () => {
            const job = new FailingJob();
            await (0, vitest_1.expect)(manager.dispatchSync(job)).rejects.toThrow('Intentional failure');
            (0, vitest_1.expect)(job.failed).toHaveBeenCalled();
        });
    });
    (0, vitest_1.describe)('push() / pushOn()', () => {
        (0, vitest_1.it)('push() pushes to connection', async () => {
            const job = new SimpleJob();
            const id = await manager.push(job);
            (0, vitest_1.expect)(id).toBe(job.uuid);
        });
        (0, vitest_1.it)('pushOn() sets queue then pushes', async () => {
            const job = new SimpleJob();
            await manager.pushOn('high', job);
            (0, vitest_1.expect)(job.queue).toBe('high');
        });
    });
    (0, vitest_1.describe)('later()', () => {
        (0, vitest_1.it)('pushes with delay', async () => {
            const job = new SimpleJob();
            const id = await manager.later(60, job);
            (0, vitest_1.expect)(id).toBe(job.uuid);
        });
    });
    (0, vitest_1.describe)('bulk()', () => {
        (0, vitest_1.it)('pushes multiple jobs', async () => {
            const jobs = [new SimpleJob(), new SimpleJob()];
            await manager.bulk(jobs);
            (0, vitest_1.expect)(jobs[0].handled).toBe(true);
            (0, vitest_1.expect)(jobs[1].handled).toBe(true);
        });
    });
    (0, vitest_1.describe)('event callbacks', () => {
        (0, vitest_1.it)('registers and fires before callbacks', () => {
            const callback = vitest_1.vi.fn();
            manager.before(callback);
            const job = new SimpleJob();
            manager.fireBeforeCallbacks('sync', job);
            (0, vitest_1.expect)(callback).toHaveBeenCalledWith('sync', job);
        });
        (0, vitest_1.it)('registers and fires after callbacks', () => {
            const callback = vitest_1.vi.fn();
            manager.after(callback);
            const job = new SimpleJob();
            manager.fireAfterCallbacks('sync', job);
            (0, vitest_1.expect)(callback).toHaveBeenCalledWith('sync', job);
        });
        (0, vitest_1.it)('registers and fires failing callbacks', () => {
            const callback = vitest_1.vi.fn();
            manager.failing(callback);
            const job = new SimpleJob();
            const error = new Error('test');
            manager.fireFailingCallbacks('sync', job, error);
            (0, vitest_1.expect)(callback).toHaveBeenCalledWith('sync', job, error);
        });
        (0, vitest_1.it)('registers and fires looping callbacks', () => {
            const callback = vitest_1.vi.fn();
            manager.looping(callback);
            manager.fireLoopingCallbacks();
            (0, vitest_1.expect)(callback).toHaveBeenCalled();
        });
    });
    (0, vitest_1.describe)('disconnect()', () => {
        (0, vitest_1.it)('removes cached connection', () => {
            const a = manager.connection();
            manager.disconnect();
            const b = manager.connection();
            (0, vitest_1.expect)(a).not.toBe(b);
        });
    });
    (0, vitest_1.describe)('configuration accessors', () => {
        (0, vitest_1.it)('getDefaultConnection()', () => {
            (0, vitest_1.expect)(manager.getDefaultConnection()).toBe('sync');
        });
        (0, vitest_1.it)('setDefaultConnection()', () => {
            manager.setDefaultConnection('null');
            (0, vitest_1.expect)(manager.getDefaultConnection()).toBe('null');
        });
        (0, vitest_1.it)('getConnections()', () => {
            (0, vitest_1.expect)(manager.getConnections()).toEqual(['sync', 'null']);
        });
        (0, vitest_1.it)('getConfig()', () => {
            (0, vitest_1.expect)(manager.getConfig().default).toBe('sync');
        });
        (0, vitest_1.it)('getConnectionConfig()', () => {
            (0, vitest_1.expect)(manager.getConnectionConfig('sync').driver).toBe('sync');
        });
        (0, vitest_1.it)('getConnectionConfig() throws for unknown', () => {
            (0, vitest_1.expect)(() => manager.getConnectionConfig('unknown')).toThrow('not configured');
        });
    });
});
//# sourceMappingURL=QueueManager.test.js.map