/**
 * Broadcast Facade
 *
 * Static access to the broadcast manager: send through the default connection,
 * register channel-authorization callbacks, or fake the whole subsystem for
 * tests.
 *
 * @example
 * ```typescript
 * import { Broadcast } from '@orchestr-sh/orchestr/Facades';
 *
 * Broadcast.channel('orders.{id}', (user, id) => user.orders.includes(Number(id)));
 * await Broadcast.broadcast(new PrivateChannel('orders.1'), 'OrderShipped', { id: 1 });
 * await Broadcast.queue(new OrderShipped(order)); // ShouldBroadcast event
 *
 * const broadcast = Broadcast.fake();
 * await Broadcast.queue(new OrderShipped(order));
 * broadcast.assertBroadcast(OrderShipped);
 * broadcast.assertBroadcastOn(['orders.1'], OrderShipped);
 * ```
 */

import type { BroadcastManager } from '@/Broadcasting/BroadcastManager';
import type { BroadcastFake } from '@/Support/Testing/Fakes/BroadcastFake';
import { Facade } from '@/Support/Facade';
import { Broadcast as BroadcastInstaller } from '@/Testing/Fakes';

class BroadcastFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'broadcast';
  }

  /**
   * Fake broadcasting for testing
   *
   * Replaces the `broadcast` container binding with a BroadcastFake that
   * records every broadcast instead of delivering it, and provides Laravel-
   * style assertions (assertBroadcast, assertBroadcastOn, assertNotBroadcast,
   * assertBroadcastTimes, assertNothingBroadcast). Delegates to the shared
   * Testing installer so `this.fakeBroadcast()` in test cases and this facade
   * always agree on the active fake (DRY).
   *
   * @returns BroadcastFake instance for making assertions
   */
  static fake(): BroadcastFake {
    const app = this.getFacadeApplication();

    if (!app) {
      throw new Error('Application not initialized. Cannot fake broadcasting.');
    }

    const fake = BroadcastInstaller.fake(app);

    // Drop any cached facade root so subsequent Broadcast.* calls resolve the fake.
    this.clearResolvedInstance(this.getFacadeAccessor());

    return fake;
  }

  /**
   * The active broadcast fake, when broadcasting is being faked through the
   * Testing installer; null otherwise.
   */
  static fakeInstance(): BroadcastFake | null {
    return BroadcastInstaller.instance();
  }
}

export const Broadcast = new Proxy(BroadcastFacadeClass, {
  get(target, prop) {
    // First check if it's a static method on the facade class itself
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    // Then try to get from the facade root (the BroadcastManager - or the
    // BroadcastFake once the binding has been swapped)
    try {
      const root = (target as any).getFacadeRoot() as BroadcastManager & BroadcastFake;
      if (root && prop in root) {
        const value = (root as any)[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(root, args);
        }
        return value;
      }
    } catch {
      // Facade root not available yet
    }

    return undefined;
  },
}) as unknown as typeof BroadcastFacadeClass & BroadcastManager & BroadcastFake;
