/**
 * Async dispatcher tests
 *
 * `dispatch()` and `until()` are promise-aware: every listener is awaited in
 * registration order before the next one runs, `false` responses from async
 * listeners halt `until()` (and model lifecycle events), and listener errors
 * are reported before propagating.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Container } from '@/Container/Container';
import { Dispatcher } from '@/Events/Dispatcher';
import { Event } from '@/Events/Event';

class OrderPlaced extends Event {
  constructor(public readonly orderId: number) {
    super();
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('Dispatcher async behaviour', () => {
  let container: Container;
  let dispatcher: Dispatcher;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = new Container();
    dispatcher = new Dispatcher(container);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe('dispatch()', () => {
    it('awaits an async listener before resolving', async () => {
      let completed = false;

      dispatcher.listen('test', async () => {
        await tick();
        completed = true;
      });

      await dispatcher.dispatch('test');

      expect(completed).toBe(true);
    });

    it('resolves with the awaited responses of async listeners', async () => {
      dispatcher.listen('test', async () => {
        await tick();
        return 'first';
      });
      dispatcher.listen('test', () => 'second');

      const results = await dispatcher.dispatch('test');

      expect(results).toEqual(['first', 'second']);
    });

    it('runs listeners sequentially in registration order', async () => {
      const order: string[] = [];

      dispatcher.listen('test', async () => {
        await tick();
        order.push('slow-first');
      });
      dispatcher.listen('test', () => {
        order.push('fast-second');
      });

      await dispatcher.dispatch('test');

      expect(order).toEqual(['slow-first', 'fast-second']);
    });

    it('keeps direct listeners ordered before wildcard listeners', async () => {
      const order: string[] = [];

      dispatcher.listen('user.*', async () => {
        await tick();
        order.push('wildcard');
      });
      dispatcher.listen('user.created', () => {
        order.push('direct');
      });

      await dispatcher.dispatch('user.created');

      expect(order).toEqual(['direct', 'wildcard']);
    });

    it('halts the loop when an async listener resolves false and halt is set', async () => {
      const later = vi.fn();

      dispatcher.listen('test', async () => {
        await tick();
        return false;
      });
      dispatcher.listen('test', later);

      await dispatcher.dispatch('test', [], true);

      expect(later).not.toHaveBeenCalled();
    });

    it('awaits class listeners registered by event class name', async () => {
      const handled: OrderPlaced[] = [];

      dispatcher.listen(OrderPlaced.name, async (event: OrderPlaced) => {
        await tick();
        handled.push(event);
      });

      await dispatcher.dispatch(new OrderPlaced(7));

      expect(handled).toHaveLength(1);
      expect(handled[0].orderId).toBe(7);
    });
  });

  describe('until()', () => {
    it('returns the first non-null awaited response', async () => {
      const later = vi.fn();

      dispatcher.listen('test', async () => {
        await tick();
        return null;
      });
      dispatcher.listen('test', async () => {
        await tick();
        return 'found';
      });
      dispatcher.listen('test', later);

      const result = await dispatcher.until('test');

      expect(result).toBe('found');
      expect(later).not.toHaveBeenCalled();
    });

    it('treats a false from an async listener as a stopping response', async () => {
      dispatcher.listen('test', async () => {
        await tick();
        return false;
      });

      await expect(dispatcher.until('test')).resolves.toBe(false);
    });

    it('resolves to null when every listener returns nothing', async () => {
      dispatcher.listen('test', async () => undefined);

      await expect(dispatcher.until('test')).resolves.toBeNull();
    });
  });

  describe('error propagation', () => {
    it('reports and propagates sync listener errors', async () => {
      const boom = new Error('listener exploded');
      const later = vi.fn();

      dispatcher.listen('test', () => {
        throw boom;
      });
      dispatcher.listen('test', later);

      await expect(dispatcher.dispatch('test')).rejects.toThrow(boom);
      expect(errorSpy).toHaveBeenCalled();
      expect(later).not.toHaveBeenCalled();
    });

    it('reports and propagates async listener rejections', async () => {
      const boom = new Error('async explosion');

      dispatcher.listen('test', async () => {
        await tick();
        throw boom;
      });

      await expect(dispatcher.dispatch('test')).rejects.toThrow(boom);
      expect(errorSpy).toHaveBeenCalledWith('Error calling event listener:', boom);
    });

    it('propagates async rejections through until()', async () => {
      dispatcher.listen('test', async () => {
        await tick();
        throw new Error('nope');
      });

      await expect(dispatcher.until('test')).rejects.toThrow('nope');
    });
  });
});
