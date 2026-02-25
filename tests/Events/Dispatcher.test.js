"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const Dispatcher_1 = require("../../src/Events/Dispatcher");
const Container_1 = require("../../src/Container/Container");
(0, vitest_1.describe)('Dispatcher', () => {
    let container;
    let dispatcher;
    (0, vitest_1.beforeEach)(() => {
        container = new Container_1.Container();
        dispatcher = new Dispatcher_1.Dispatcher(container);
    });
    (0, vitest_1.describe)('listen()', () => {
        (0, vitest_1.it)('registers a closure listener', () => {
            const listener = vitest_1.vi.fn();
            dispatcher.listen('user.created', listener);
            (0, vitest_1.expect)(dispatcher.hasListeners('user.created')).toBe(true);
        });
        (0, vitest_1.it)('registers multiple events at once', () => {
            const listener = vitest_1.vi.fn();
            dispatcher.listen(['event.a', 'event.b'], listener);
            (0, vitest_1.expect)(dispatcher.hasListeners('event.a')).toBe(true);
            (0, vitest_1.expect)(dispatcher.hasListeners('event.b')).toBe(true);
        });
        (0, vitest_1.it)('registers wildcard listeners', () => {
            const listener = vitest_1.vi.fn();
            dispatcher.listen('user.*', listener);
            (0, vitest_1.expect)(dispatcher.hasListeners('user.created')).toBe(true);
        });
    });
    (0, vitest_1.describe)('dispatch()', () => {
        (0, vitest_1.it)('calls registered listeners with string events', () => {
            const listener = vitest_1.vi.fn();
            dispatcher.listen('test.event', listener);
            dispatcher.dispatch('test.event');
            (0, vitest_1.expect)(listener).toHaveBeenCalledOnce();
        });
        (0, vitest_1.it)('passes event name and payload to listener', () => {
            const listener = vitest_1.vi.fn();
            dispatcher.listen('test.event', listener);
            dispatcher.dispatch('test.event', ['arg1', 'arg2']);
            (0, vitest_1.expect)(listener).toHaveBeenCalledWith('test.event', 'arg1', 'arg2');
        });
        (0, vitest_1.it)('calls multiple listeners', () => {
            const listener1 = vitest_1.vi.fn();
            const listener2 = vitest_1.vi.fn();
            dispatcher.listen('test', listener1);
            dispatcher.listen('test', listener2);
            dispatcher.dispatch('test');
            (0, vitest_1.expect)(listener1).toHaveBeenCalled();
            (0, vitest_1.expect)(listener2).toHaveBeenCalled();
        });
        (0, vitest_1.it)('collects non-null responses', () => {
            dispatcher.listen('test', () => 'a');
            dispatcher.listen('test', () => 'b');
            const results = dispatcher.dispatch('test');
            (0, vitest_1.expect)(results).toEqual(['a', 'b']);
        });
        (0, vitest_1.it)('halts on false when halt=true', () => {
            const listener1 = vitest_1.vi.fn(() => false);
            const listener2 = vitest_1.vi.fn(() => 'after');
            dispatcher.listen('test', listener1);
            dispatcher.listen('test', listener2);
            dispatcher.dispatch('test', [], true);
            (0, vitest_1.expect)(listener1).toHaveBeenCalled();
            (0, vitest_1.expect)(listener2).not.toHaveBeenCalled();
        });
        (0, vitest_1.it)('dispatches to wildcard listeners', () => {
            const listener = vitest_1.vi.fn();
            dispatcher.listen('user.*', listener);
            dispatcher.dispatch('user.created');
            (0, vitest_1.expect)(listener).toHaveBeenCalled();
        });
        (0, vitest_1.it)('dispatches to both direct and wildcard listeners', () => {
            const direct = vitest_1.vi.fn();
            const wildcard = vitest_1.vi.fn();
            dispatcher.listen('user.created', direct);
            dispatcher.listen('user.*', wildcard);
            dispatcher.dispatch('user.created');
            (0, vitest_1.expect)(direct).toHaveBeenCalled();
            (0, vitest_1.expect)(wildcard).toHaveBeenCalled();
        });
        (0, vitest_1.it)('dispatches class instance listeners with handle method', () => {
            class MyListener {
                handle = vitest_1.vi.fn();
            }
            const instance = new MyListener();
            dispatcher.listen('test', instance);
            dispatcher.dispatch('test');
            (0, vitest_1.expect)(instance.handle).toHaveBeenCalled();
        });
    });
    (0, vitest_1.describe)('until()', () => {
        (0, vitest_1.it)('returns first non-null response', () => {
            dispatcher.listen('test', () => null);
            dispatcher.listen('test', () => 'found');
            dispatcher.listen('test', () => 'also');
            const result = dispatcher.until('test');
            (0, vitest_1.expect)(result).toBe('found');
        });
        (0, vitest_1.it)('returns null if no listener returns value', () => {
            dispatcher.listen('test', () => null);
            const result = dispatcher.until('test');
            (0, vitest_1.expect)(result).toBeNull();
        });
    });
    (0, vitest_1.describe)('push() / flush()', () => {
        (0, vitest_1.it)('queues events and flushes them', () => {
            const listener = vitest_1.vi.fn();
            dispatcher.listen('deferred', listener);
            dispatcher.push('deferred', ['data']);
            (0, vitest_1.expect)(listener).not.toHaveBeenCalled();
            dispatcher.flush('deferred');
            (0, vitest_1.expect)(listener).toHaveBeenCalledWith('deferred', 'data');
        });
        (0, vitest_1.it)('does not fail when flushing empty queue', () => {
            (0, vitest_1.expect)(() => dispatcher.flush('nonexistent')).not.toThrow();
        });
        (0, vitest_1.it)('clears queue after flushing', () => {
            const listener = vitest_1.vi.fn();
            dispatcher.listen('event', listener);
            dispatcher.push('event');
            dispatcher.flush('event');
            dispatcher.flush('event');
            (0, vitest_1.expect)(listener).toHaveBeenCalledOnce();
        });
    });
    (0, vitest_1.describe)('forget()', () => {
        (0, vitest_1.it)('removes all listeners for an event', () => {
            dispatcher.listen('test', vitest_1.vi.fn());
            dispatcher.forget('test');
            (0, vitest_1.expect)(dispatcher.hasListeners('test')).toBe(false);
        });
    });
    (0, vitest_1.describe)('forgetPushed()', () => {
        (0, vitest_1.it)('clears all queued events', () => {
            const listener = vitest_1.vi.fn();
            dispatcher.listen('event', listener);
            dispatcher.push('event');
            dispatcher.forgetPushed();
            dispatcher.flush('event');
            (0, vitest_1.expect)(listener).not.toHaveBeenCalled();
        });
    });
    (0, vitest_1.describe)('subscribe()', () => {
        (0, vitest_1.it)('registers subscriber that returns mapping', () => {
            const listener = vitest_1.vi.fn();
            dispatcher.subscribe({
                subscribe: () => ({
                    'user.created': listener,
                    'user.deleted': listener,
                }),
            });
            dispatcher.dispatch('user.created');
            dispatcher.dispatch('user.deleted');
            (0, vitest_1.expect)(listener).toHaveBeenCalledTimes(2);
        });
        (0, vitest_1.it)('handles subscriber that returns array listeners', () => {
            const listener1 = vitest_1.vi.fn();
            const listener2 = vitest_1.vi.fn();
            dispatcher.subscribe({
                subscribe: () => ({
                    'test': [listener1, listener2],
                }),
            });
            dispatcher.dispatch('test');
            (0, vitest_1.expect)(listener1).toHaveBeenCalled();
            (0, vitest_1.expect)(listener2).toHaveBeenCalled();
        });
    });
    (0, vitest_1.describe)('hasListeners()', () => {
        (0, vitest_1.it)('returns false for events with no listeners', () => {
            (0, vitest_1.expect)(dispatcher.hasListeners('nothing')).toBe(false);
        });
        (0, vitest_1.it)('returns true for events with direct listeners', () => {
            dispatcher.listen('test', vitest_1.vi.fn());
            (0, vitest_1.expect)(dispatcher.hasListeners('test')).toBe(true);
        });
        (0, vitest_1.it)('returns true for events matching wildcard pattern', () => {
            dispatcher.listen('order.*', vitest_1.vi.fn());
            (0, vitest_1.expect)(dispatcher.hasListeners('order.placed')).toBe(true);
        });
    });
    (0, vitest_1.describe)('wildcard matching', () => {
        (0, vitest_1.it)('matches single segment wildcard', () => {
            const listener = vitest_1.vi.fn();
            dispatcher.listen('app.*', listener);
            dispatcher.dispatch('app.started');
            (0, vitest_1.expect)(listener).toHaveBeenCalled();
        });
        (0, vitest_1.it)('matches multi-segment wildcard', () => {
            const listener = vitest_1.vi.fn();
            dispatcher.listen('app.*', listener);
            dispatcher.dispatch('app.user.created');
            (0, vitest_1.expect)(listener).toHaveBeenCalled();
        });
        (0, vitest_1.it)('matches catch-all wildcard', () => {
            const listener = vitest_1.vi.fn();
            dispatcher.listen('*', listener);
            dispatcher.dispatch('anything');
            (0, vitest_1.expect)(listener).toHaveBeenCalled();
        });
    });
    (0, vitest_1.describe)('getRawListeners()', () => {
        (0, vitest_1.it)('returns the listeners map', () => {
            const listener = vitest_1.vi.fn();
            dispatcher.listen('test', listener);
            const raw = dispatcher.getRawListeners();
            (0, vitest_1.expect)(raw.get('test')).toContain(listener);
        });
    });
});
//# sourceMappingURL=Dispatcher.test.js.map