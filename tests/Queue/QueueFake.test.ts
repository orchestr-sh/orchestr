/**
 * Queue.fake() tests
 *
 * Verifies the faked queue records dispatches instead of sending them to a
 * driver, and that the Laravel-style assertions (assertPushed,
 * assertPushedOn, assertNotPushed, assertPushedWithChain,
 * assertPushedWithBatch) behave.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Bus } from '@/Facades/Bus';
import { Queue } from '@/Facades/Queue';
import { Application } from '@/Foundation/Application';
import { Job } from '@/Queue/Job';
import { Facade } from '@/Support/Facade';
import { QueueFake } from '@/Support/Testing/Fakes/QueueFake';

class StartJob extends Job {
  constructor(public id: number = 1) {
    super();
  }

  async handle(): Promise<void> {}
}

class OptimizeJob extends Job {
  async handle(): Promise<void> {}
}

class ReleaseJob extends Job {
  async handle(): Promise<void> {}
}

class OtherJob extends Job {
  async handle(): Promise<void> {}
}

class DelayedJob extends Job {
  async handle(): Promise<void> {}
}

describe('QueueFake', () => {
  let fake: QueueFake;

  beforeEach(() => {
    const app = new Application('/test');
    Facade.setFacadeApplication(app);
    fake = Queue.fake();
  });

  afterEach(() => {
    Facade.clearResolvedInstances();
    Facade.setFacadeApplication(undefined as any);
  });

  it('Queue.fake() swaps the container binding and returns the fake', () => {
    const app = Facade.getFacadeApplication();

    expect(app.make('queue')).toBe(fake);
  });

  it('records dispatched jobs without executing them', async () => {
    await StartJob.dispatch(3);

    expect(fake.assertPushed(StartJob)).toBeUndefined();
    expect(fake.pushed(StartJob)).toHaveLength(1);
    expect((fake.pushed(StartJob)[0] as StartJob).id).toBe(3);
  });

  it('records jobs pushed through the facade', async () => {
    await Queue.push(new StartJob(1));
    await Queue.push(new OtherJob());

    fake.assertPushed(StartJob);
    fake.assertPushed(OtherJob);
    fake.assertPushedTimes(StartJob, 1);
  });

  it('assertNotPushed passes for jobs that never arrived', async () => {
    await Queue.push(new StartJob());

    fake.assertNotPushed(OtherJob);

    expect(() => fake.assertNotPushed(StartJob)).toThrow(/was pushed 1 time\(s\)/);
  });

  it('assertPushed matches on the job callback', async () => {
    await Queue.push(new StartJob(7));

    fake.assertPushed(StartJob, (job) => (job as StartJob).id === 7);

    expect(() => fake.assertPushed(StartJob, (job) => (job as StartJob).id === 99)).toThrow(
      /none matched the callback/
    );
  });

  it('assertPushedOn checks the named queue', async () => {
    await Queue.push(new StartJob(), 'emails');
    await Queue.later(60, new OtherJob(), 'reminders');

    fake.assertPushedOn('emails', StartJob);
    fake.assertPushedOn('reminders', OtherJob);

    expect(() => fake.assertPushedOn('emails', OtherJob)).toThrow(/not pushed on queue \[emails\]/);
  });

  it('records the delay given to later()', async () => {
    await Queue.later(120, new DelayedJob());

    const record = fake.records(DelayedJob)[0];
    expect(record.delay).toBe(120);
    expect(record.queue).toBe('default');
  });

  it('records jobs dispatched fluently with onQueue()', async () => {
    await StartJob.dispatch(1).onQueue('high');

    fake.assertPushedOn('high', StartJob);
  });

  it('assertNothingPushed flags any recorded job', async () => {
    fake.assertNothingPushed();

    await Queue.push(new StartJob());

    expect(() => fake.assertNothingPushed()).toThrow(/Expected no jobs to be pushed/);
  });

  it('throws a helpful error when a job was not pushed', () => {
    expect(() => fake.assertPushed(StartJob)).toThrow(/was not pushed/);
  });

  // --- Chains ---

  it('assertPushedWithChain records the chain from Bus.chain()', async () => {
    await Bus.chain([new StartJob(1), new OptimizeJob(), new ReleaseJob()]).dispatch();

    fake.assertPushedWithChain(StartJob);
    fake.assertPushedWithChain(StartJob, ['OptimizeJob', 'ReleaseJob']);

    // A chain only dispatches its head; the rest run when predecessors finish
    fake.assertNotPushed(OptimizeJob);
    fake.assertNotPushed(ReleaseJob);

    expect(() => fake.assertPushedWithChain(StartJob, ['OptimizeJob'])).toThrow(/expected chain/i);
    expect(() => fake.assertPushedWithChain(OtherJob)).toThrow(/not pushed as part of a chain/);
  });

  it('assertPushedWithoutChain fails for chained jobs', async () => {
    await Bus.chain([new StartJob(), new OptimizeJob()]).dispatch();

    expect(() => fake.assertPushedWithoutChain(StartJob)).toThrow(/with a chain/);
  });

  // --- Batches ---

  it('assertPushedWithBatch records the batch from Bus.batch()', async () => {
    const batch = await Bus.batch([new StartJob(1), new StartJob(2)])
      .name('startup')
      .dispatch();

    fake.assertPushedWithBatch(StartJob);
    fake.assertPushedWithBatch(StartJob, batch.id);
    fake.assertPushedTimes(StartJob, 2);

    expect(() => fake.assertPushedWithBatch(StartJob, 'some-other-batch')).toThrow(/not pushed with batch/);
    expect(() => fake.assertPushedWithBatch(OtherJob)).toThrow(/not pushed/);
  });

  it('records non-batched jobs without a batch id', async () => {
    await Queue.push(new StartJob());

    expect(() => fake.assertPushedWithBatch(StartJob)).toThrow(/not pushed as part of a batch/);
  });

  // --- Driver surface ---

  it('supports size and clear like a queue connection', async () => {
    await Queue.push(new StartJob(), 'a');
    await Queue.push(new OtherJob(), 'b');

    expect(await fake.size('a')).toBe(1);
    expect(await fake.size('b')).toBe(1);

    const removed = await fake.clear('a');
    expect(removed).toBe(1);
    expect(await fake.size('a')).toBe(0);
  });

  it('never executes dispatchSync jobs but records them', async () => {
    const job = new StartJob(5);

    await Queue.dispatchSync(job);

    expect(fake.assertPushed(StartJob)).toBeUndefined();
    expect(fake.records()).toHaveLength(1);
  });

  it('reset clears all recorded pushes', async () => {
    await Queue.push(new StartJob());
    fake.reset();

    fake.assertNothingPushed();
  });

  it('works standalone without the facade', async () => {
    const standalone = new QueueFake({ connection: 'redis', queue: 'work' });

    await standalone.dispatch(new StartJob());

    standalone.assertPushed(StartJob);
    expect(standalone.records()[0].connection).toBe('redis');
    expect(standalone.records()[0].queue).toBe('work');
  });
});
