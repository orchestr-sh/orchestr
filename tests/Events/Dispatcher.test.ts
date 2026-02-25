import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Dispatcher } from '@/Events/Dispatcher';
import { Container } from '@/Container/Container';

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
  });

  describe('dispatch()', () => {
    it('calls registered listeners with string events', () => {
      const listener = vi.fn();
      dispatcher.listen('test.event', listener);
      dispatcher.dispatch('test.event');
      expect(listener).toHaveBeenCalledOnce();
    });

    it('passes event name and payload to listener', () => {
      const listener = vi.fn();
      dispatcher.listen('test.event', listener);
      dispatcher.dispatch('test.event', ['arg1', 'arg2']);
      expect(listener).toHaveBeenCalledWith('test.event', 'arg1', 'arg2');
    });

    it('calls multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      dispatcher.listen('test', listener1);
      dispatcher.listen('test', listener2);
      dispatcher.dispatch('test');
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('collects non-null responses', () => {
      dispatcher.listen('test', () => 'a');
      dispatcher.listen('test', () => 'b');
      const results = dispatcher.dispatch('test');
      expect(results).toEqual(['a', 'b']);
    });

    it('halts on false when halt=true', () => {
      const listener1 = vi.fn(() => false);
      const listener2 = vi.fn(() => 'after');
      dispatcher.listen('test', listener1);
      dispatcher.listen('test', listener2);
      dispatcher.dispatch('test', [], true);
      expect(listener1).toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });

    it('dispatches to wildcard listeners', () => {
      const listener = vi.fn();
      dispatcher.listen('user.*', listener);
      dispatcher.dispatch('user.created');
      expect(listener).toHaveBeenCalled();
    });

    it('dispatches to both direct and wildcard listeners', () => {
      const direct = vi.fn();
      const wildcard = vi.fn();
      dispatcher.listen('user.created', direct);
      dispatcher.listen('user.*', wildcard);
      dispatcher.dispatch('user.created');
      expect(direct).toHaveBeenCalled();
      expect(wildcard).toHaveBeenCalled();
    });

    it('dispatches class instance listeners with handle method', () => {
      class MyListener {
        handle = vi.fn();
      }
      const instance = new MyListener();
      dispatcher.listen('test', instance);
      dispatcher.dispatch('test');
      expect(instance.handle).toHaveBeenCalled();
    });
  });

  describe('until()', () => {
    it('returns first non-null response', () => {
      dispatcher.listen('test', () => null);
      dispatcher.listen('test', () => 'found');
      dispatcher.listen('test', () => 'also');
      const result = dispatcher.until('test');
      expect(result).toBe('found');
    });

    it('returns null if no listener returns value', () => {
      dispatcher.listen('test', () => null);
      const result = dispatcher.until('test');
      expect(result).toBeNull();
    });
  });

  describe('push() / flush()', () => {
    it('queues events and flushes them', () => {
      const listener = vi.fn();
      dispatcher.listen('deferred', listener);
      dispatcher.push('deferred', ['data']);
      expect(listener).not.toHaveBeenCalled();

      dispatcher.flush('deferred');
      expect(listener).toHaveBeenCalledWith('deferred', 'data');
    });

    it('does not fail when flushing empty queue', () => {
      expect(() => dispatcher.flush('nonexistent')).not.toThrow();
    });

    it('clears queue after flushing', () => {
      const listener = vi.fn();
      dispatcher.listen('event', listener);
      dispatcher.push('event');
      dispatcher.flush('event');
      dispatcher.flush('event');
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe('forget()', () => {
    it('removes all listeners for an event', () => {
      dispatcher.listen('test', vi.fn());
      dispatcher.forget('test');
      expect(dispatcher.hasListeners('test')).toBe(false);
    });
  });

  describe('forgetPushed()', () => {
    it('clears all queued events', () => {
      const listener = vi.fn();
      dispatcher.listen('event', listener);
      dispatcher.push('event');
      dispatcher.forgetPushed();
      dispatcher.flush('event');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('subscribe()', () => {
    it('registers subscriber that returns mapping', () => {
      const listener = vi.fn();
      dispatcher.subscribe({
        subscribe: () => ({
          'user.created': listener,
          'user.deleted': listener,
        }),
      });
      dispatcher.dispatch('user.created');
      dispatcher.dispatch('user.deleted');
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('handles subscriber that returns array listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      dispatcher.subscribe({
        subscribe: () => ({
          test: [listener1, listener2],
        }),
      });
      dispatcher.dispatch('test');
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });

  describe('hasListeners()', () => {
    it('returns false for events with no listeners', () => {
      expect(dispatcher.hasListeners('nothing')).toBe(false);
    });

    it('returns true for events with direct listeners', () => {
      dispatcher.listen('test', vi.fn());
      expect(dispatcher.hasListeners('test')).toBe(true);
    });

    it('returns true for events matching wildcard pattern', () => {
      dispatcher.listen('order.*', vi.fn());
      expect(dispatcher.hasListeners('order.placed')).toBe(true);
    });
  });

  describe('wildcard matching', () => {
    it('matches single segment wildcard', () => {
      const listener = vi.fn();
      dispatcher.listen('app.*', listener);
      dispatcher.dispatch('app.started');
      expect(listener).toHaveBeenCalled();
    });

    it('matches multi-segment wildcard', () => {
      const listener = vi.fn();
      dispatcher.listen('app.*', listener);
      dispatcher.dispatch('app.user.created');
      expect(listener).toHaveBeenCalled();
    });

    it('matches catch-all wildcard', () => {
      const listener = vi.fn();
      dispatcher.listen('*', listener);
      dispatcher.dispatch('anything');
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
  });
});
