import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueueManager } from '@/Queue/QueueManager';
import { NullDriver } from '@/Queue/Drivers/NullDriver';
import { SyncDriver } from '@/Queue/Drivers/SyncDriver';
import { Job } from '@/Queue/Job';

class SimpleJob extends Job {
  public handled = false;
  async handle(): Promise<void> {
    this.handled = true;
  }
}

class FailingJob extends Job {
  failed = vi.fn();
  async handle(): Promise<void> {
    throw new Error('Intentional failure');
  }
}

describe('QueueManager', () => {
  let manager: QueueManager;

  beforeEach(() => {
    manager = new QueueManager({
      default: 'sync',
      connections: {
        sync: { driver: 'sync', queue: 'default' },
        null: { driver: 'null', queue: 'default' },
      },
    });

    manager.registerDriver('sync', (config) => new SyncDriver(config));
    manager.registerDriver('null', (config) => new NullDriver(config));
  });

  describe('connection()', () => {
    it('returns default connection', () => {
      const driver = manager.connection();
      expect(driver).toBeDefined();
    });

    it('returns named connection', () => {
      const driver = manager.connection('null');
      expect(driver).toBeDefined();
    });

    it('caches connections', () => {
      const a = manager.connection();
      const b = manager.connection();
      expect(a).toBe(b);
    });

    it('throws for unconfigured connection', () => {
      expect(() => manager.connection('redis')).toThrow('not configured');
    });

    it('throws for unregistered driver', () => {
      const mgr = new QueueManager({
        default: 'custom',
        connections: { custom: { driver: 'custom' } },
      });
      expect(() => mgr.connection()).toThrow('not registered');
    });
  });

  describe('registerDriver()', () => {
    it('registers a new driver factory', () => {
      manager.registerDriver('custom', (config) => new NullDriver(config));
      const mgr = new QueueManager({
        default: 'test',
        connections: { test: { driver: 'custom' } },
      });
      mgr.registerDriver('custom', (config) => new NullDriver(config));
      expect(mgr.connection()).toBeDefined();
    });
  });

  describe('registerJob() / getJobClass()', () => {
    it('registers and retrieves job classes', () => {
      manager.registerJob('SimpleJob', SimpleJob);
      expect(manager.getJobClass('SimpleJob')).toBe(SimpleJob);
    });

    it('returns undefined for unregistered jobs', () => {
      expect(manager.getJobClass('Unknown')).toBeUndefined();
    });
  });

  describe('dispatch()', () => {
    it('dispatches a job to the queue', async () => {
      const job = new SimpleJob();
      const id = await manager.dispatch(job);
      expect(id).toBe(job.uuid);
      expect(job.handled).toBe(true); // sync driver executes immediately
    });

    it('uses job connection if set', async () => {
      const job = new SimpleJob();
      job.connection = 'null';
      const id = await manager.dispatch(job);
      expect(id).toBe(job.uuid);
      expect(job.handled).toBe(false); // null driver doesn't execute
    });

    it('uses later() when delay is set', async () => {
      const job = new SimpleJob();
      job.delay = 60;
      const id = await manager.dispatch(job);
      expect(id).toBe(job.uuid);
    });
  });

  describe('dispatchSync()', () => {
    it('executes job immediately', async () => {
      const job = new SimpleJob();
      await manager.dispatchSync(job);
      expect(job.handled).toBe(true);
    });

    it('calls failed() on error', async () => {
      const job = new FailingJob();
      await expect(manager.dispatchSync(job)).rejects.toThrow('Intentional failure');
      expect(job.failed).toHaveBeenCalled();
    });
  });

  describe('push() / pushOn()', () => {
    it('push() pushes to connection', async () => {
      const job = new SimpleJob();
      const id = await manager.push(job);
      expect(id).toBe(job.uuid);
    });

    it('pushOn() sets queue then pushes', async () => {
      const job = new SimpleJob();
      await manager.pushOn('high', job);
      expect(job.queue).toBe('high');
    });
  });

  describe('later()', () => {
    it('pushes with delay', async () => {
      const job = new SimpleJob();
      const id = await manager.later(60, job);
      expect(id).toBe(job.uuid);
    });
  });

  describe('bulk()', () => {
    it('pushes multiple jobs', async () => {
      const jobs = [new SimpleJob(), new SimpleJob()];
      await manager.bulk(jobs);
      expect(jobs[0].handled).toBe(true);
      expect(jobs[1].handled).toBe(true);
    });
  });

  describe('event callbacks', () => {
    it('registers and fires before callbacks', () => {
      const callback = vi.fn();
      manager.before(callback);
      const job = new SimpleJob();
      manager.fireBeforeCallbacks('sync', job);
      expect(callback).toHaveBeenCalledWith('sync', job);
    });

    it('registers and fires after callbacks', () => {
      const callback = vi.fn();
      manager.after(callback);
      const job = new SimpleJob();
      manager.fireAfterCallbacks('sync', job);
      expect(callback).toHaveBeenCalledWith('sync', job);
    });

    it('registers and fires failing callbacks', () => {
      const callback = vi.fn();
      manager.failing(callback);
      const job = new SimpleJob();
      const error = new Error('test');
      manager.fireFailingCallbacks('sync', job, error);
      expect(callback).toHaveBeenCalledWith('sync', job, error);
    });

    it('registers and fires looping callbacks', () => {
      const callback = vi.fn();
      manager.looping(callback);
      manager.fireLoopingCallbacks();
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('disconnect()', () => {
    it('removes cached connection', () => {
      const a = manager.connection();
      manager.disconnect();
      const b = manager.connection();
      expect(a).not.toBe(b);
    });
  });

  describe('configuration accessors', () => {
    it('getDefaultConnection()', () => {
      expect(manager.getDefaultConnection()).toBe('sync');
    });

    it('setDefaultConnection()', () => {
      manager.setDefaultConnection('null');
      expect(manager.getDefaultConnection()).toBe('null');
    });

    it('getConnections()', () => {
      expect(manager.getConnections()).toEqual(['sync', 'null']);
    });

    it('getConfig()', () => {
      expect(manager.getConfig().default).toBe('sync');
    });

    it('getConnectionConfig()', () => {
      expect(manager.getConnectionConfig('sync').driver).toBe('sync');
    });

    it('getConnectionConfig() throws for unknown', () => {
      expect(() => manager.getConnectionConfig('unknown')).toThrow('not configured');
    });
  });
});
