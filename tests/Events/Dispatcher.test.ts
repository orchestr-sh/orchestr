import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '@/Container/Container';
import { Dispatcher } from '@/Events/Dispatcher';
import { Event } from '@/Events/Event';

class UserRegistered extends Event {
  constructor(public readonly name: string) {
    super();
  }
}

describe('Dispatcher', () => {
  let container: Container;
  let dispatcher: Dispatcher;

  beforeEach(() => {
    container = new Container();
    dispatcher = new Dispatcher(container);
  });

  describe('listen()', () => {
    it('registers a closure listener', () => {
      const listener = vi.fn();
      dispatcher.listen('user.created', listener);
      expect(dispatcher.hasListeners('user.created')).toBe(true);
    });

    it('registers multiple events at once', () => {
      const listener = vi.fn();
      dispatcher.listen(['event.a', 'event.b'], listener);
      expect(dispatcher.hasListeners('event.a')).toBe(true);
      expect(dispatcher.hasListeners('event.b')).toBe(true);
    });

    it('registers wildcard listeners', () => {
      const listener = vi.fn();
      dispatcher.listen('user.*', listener);
      expect(dispatcher.hasListeners('user.created')).toBe(true);
    });

    it('registers by event class reference and dispatches object events to it', async () => {
      const listener = vi.fn();
      dispatcher.listen(UserRegistered, listener);

      expect(dispatcher.hasListeners('UserRegistered')).toBe(true);

      const event = new UserRegistered('Ada');
      await dispatcher.dispatch(event);

      expect(listener).toHaveBeenCalledWith(event);
    });

    it('mixes class references with names and wildcard patterns', async () => {
      const direct = vi.fn();
      const wildcard = vi.fn();
      dispatcher.listen([UserRegistered, 'user.created'], direct);
      dispatcher.listen('*', wildcard);

      await dispatcher.dispatch(new UserRegistered('Grace'));

      expect(direct).toHaveBeenCalledTimes(1);
      expect(wildcard).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispatch()', () => {
    it('calls registered listeners with string events', async () => {
      const listener = vi.fn();
      dispatcher.listen('test.event', listener);
      await dispatcher.dispatch('test.event');
      expect(listener).toHaveBeenCalledOnce();
    });

    it('passes event name and payload to listener', async () => {
      const listener = vi.fn();
      dispatcher.listen('test.event', listener);
      await dispatcher.dispatch('test.event', ['arg1', 'arg2']);
      expect(listener).toHaveBeenCalledWith('test.event', 'arg1', 'arg2');
    });

    it('calls multiple listeners', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      dispatcher.listen('test', listener1);
      dispatcher.listen('test', listener2);
      await dispatcher.dispatch('test');
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('collects non-null responses', async () => {
      dispatcher.listen('test', () => 'a');
      dispatcher.listen('test', () => 'b');
      const results = await dispatcher.dispatch('test');
      expect(results).toEqual(['a', 'b']);
    });

    it('halts on false when halt=true', async () => {
      const listener1 = vi.fn(() => false);
      const listener2 = vi.fn(() => 'after');
      dispatcher.listen('test', listener1);
      dispatcher.listen('test', listener2);
      await dispatcher.dispatch('test', [], true);
      expect(listener1).toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });

    it('dispatches to wildcard listeners', async () => {
      const listener = vi.fn();
      dispatcher.listen('user.*', listener);
      await dispatcher.dispatch('user.created');
      expect(listener).toHaveBeenCalled();
    });

    it('dispatches to both direct and wildcard listeners', async () => {
      const direct = vi.fn();
      const wildcard = vi.fn();
      dispatcher.listen('user.created', direct);
      dispatcher.listen('user.*', wildcard);
      await dispatcher.dispatch('user.created');
      expect(direct).toHaveBeenCalled();
      expect(wildcard).toHaveBeenCalled();
    });

    it('dispatches class instance listeners with handle method', async () => {
      class MyListener {
        handle = vi.fn();
      }
      const instance = new MyListener();
      dispatcher.listen('test', instance);
      await dispatcher.dispatch('test');
      expect(instance.handle).toHaveBeenCalled();
    });
  });

  describe('until()', () => {
    it('returns first non-null response', async () => {
      dispatcher.listen('test', () => null);
      dispatcher.listen('test', () => 'found');
      dispatcher.listen('test', () => 'also');
      const result = await dispatcher.until('test');
      expect(result).toBe('found');
    });

    it('returns null if no listener returns value', async () => {
      dispatcher.listen('test', () => null);
      const result = await dispatcher.until('test');
      expect(result).toBeNull();
    });
  });

  describe('push() / flush()', () => {
    it('queues events and flushes them', async () => {
      const listener = vi.fn();
      dispatcher.listen('deferred', listener);
      dispatcher.push('deferred', ['data']);
      expect(listener).not.toHaveBeenCalled();

      await dispatcher.flush('deferred');
      expect(listener).toHaveBeenCalledWith('deferred', 'data');
    });

    it('does not fail when flushing empty queue', async () => {
      await expect(dispatcher.flush('nonexistent')).resolves.toBeUndefined();
    });

    it('clears queue after flushing', async () => {
      const listener = vi.fn();
      dispatcher.listen('event', listener);
      dispatcher.push('event');
      await dispatcher.flush('event');
      await dispatcher.flush('event');
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe('forget()', () => {
    it('removes all listeners for an event', () => {
      const listener = vi.fn();
      dispatcher.listen('test', listener);
      dispatcher.forget('test');
      expect(dispatcher.hasListeners('test')).toBe(false);
    });
  });

  describe('forgetPushed()', () => {
    it('clears all queued events', async () => {
      const listener = vi.fn();
      dispatcher.listen('event', listener);
      dispatcher.push('event');
      dispatcher.forgetPushed();
      await dispatcher.flush('event');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('subscribe()', () => {
    it('registers subscriber that returns mapping', async () => {
      const listener = vi.fn();
      dispatcher.subscribe({
        subscribe: () => ({
          'user.created': listener,
          'user.deleted': listener,
        }),
      });
      await dispatcher.dispatch('user.created');
      await dispatcher.dispatch('user.deleted');
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('handles subscriber that returns array listeners', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      dispatcher.subscribe({
        subscribe: () => ({
          test: [listener1, listener2],
        }),
      });
      await dispatcher.dispatch('test');
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });

  describe('hasListeners()', () => {
    it('returns false for events with no listeners', () => {
      expect(dispatcher.hasListeners('nothing')).toBe(false);
    });

    it('returns true for events with direct listeners', () => {
      const listener = vi.fn();
      dispatcher.listen('test', listener);
      expect(dispatcher.hasListeners('test')).toBe(true);
    });

    it('returns true for events matching wildcard pattern', () => {
      const listener = vi.fn();
      dispatcher.listen('order.*', listener);
      expect(dispatcher.hasListeners('order.placed')).toBe(true);
    });
  });

  describe('wildcard matching', () => {
    it('matches single segment wildcard', async () => {
      const listener = vi.fn();
      dispatcher.listen('app.*', listener);
      await dispatcher.dispatch('app.started');
      expect(listener).toHaveBeenCalled();
    });

    it('matches multi-segment wildcard', async () => {
      const listener = vi.fn();
      dispatcher.listen('app.*', listener);
      await dispatcher.dispatch('app.user.created');
      expect(listener).toHaveBeenCalled();
    });

    it('matches catch-all wildcard', async () => {
      const listener = vi.fn();
      dispatcher.listen('*', listener);
      await dispatcher.dispatch('anything');
      expect(listener).toHaveBeenCalled();
    });
  });

  describe('getRawListeners()', () => {
    it('returns the listeners map', () => {
      const listener = vi.fn();
      dispatcher.listen('test', listener);
      const raw = dispatcher.getRawListeners();
      expect(raw.get('test')).toContain(listener);
    });

    it('includes wildcard listeners keyed by their pattern', () => {
      const listener = vi.fn();
      dispatcher.listen('user.*', listener);
      const raw = dispatcher.getRawListeners();
      expect(raw.get('user.*')).toContain(listener);
    });
  });
});
