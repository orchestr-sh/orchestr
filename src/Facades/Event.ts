import { Facade } from '@/Support/Facade';
import type { Dispatcher } from '@/Events/Dispatcher';
import { EventFake } from '@/Support/Testing/Fakes/EventFake';
import type { Event as EventClass } from '@/Events/Event';
import type { EventListener } from '@/Events/types';

/**
 * Event Facade
 *
 * Provides static access to the event dispatcher for listening to and dispatching events.
 * Includes testing utilities for faking events in tests.
 *
 * @example
 * ```typescript
 * // Listen to events
 * Event.listen(UserRegistered, SendWelcomeEmail);
 * Event.listen('user.*', (event) => console.log(event));
 *
 * // Dispatch events
 * Event.dispatch(new UserRegistered(user));
 * Event.dispatch('user.registered', [user]);
 *
 * // Dispatch until first non-null response
 * const result = Event.until(new ValidateUser(user));
 *
 * // Testing - Fake all events
 * Event.fake();
 * // Your code that dispatches events
 * Event.assertDispatched(UserRegistered);
 * Event.assertDispatchedTimes(UserRegistered, 2);
 *
 * // Fake specific events
 * Event.fake([UserRegistered, OrderPlaced]);
 *
 * // Fake all except specific events
 * Event.fakeExcept([UserDeleted]);
 * ```
 */
class EventFacadeClass extends Facade {
  protected static getFacadeAccessor(): string {
    return 'events';
  }
  /**
   * Fake events for testing
   *
   * Replaces the real event dispatcher with a fake that records all
   * dispatched events instead of calling listeners. Returns the fake
   * instance for making assertions.
   *
   * @param events - Optional array of events to fake (fakes all if not provided)
   * @returns EventFake instance for assertions
   *
   * @example
   * ```typescript
   * // Fake all events
   * const fake = Event.fake();
   * // Your code
   * fake.assertDispatched(UserRegistered);
   *
   * // Fake specific events only
   * Event.fake([UserRegistered, OrderPlaced]);
   * ```
   */
  static fake(events?: (string | (new (...args: any[]) => EventClass))[]): EventFake {
    const app = this.getFacadeApplication();
    const fake = new EventFake(app);

    if (events && events.length > 0) {
      // Create selective fake that only intercepts specified events
      const eventNames = events.map((e) => (typeof e === 'string' ? e : e.name));
      fake.setFakedEvents(eventNames);

      // Store original dispatcher for pass-through
      try {
        const originalDispatcher = app.make<Dispatcher>('events');
        fake.setOriginalDispatcher(originalDispatcher);
      } catch (error) {
        // Dispatcher not registered yet, that's okay
      }
    }

    // Replace the events binding with the fake
    app.instance('events', fake);
    this.clearResolvedInstance('events');

    return fake;
  }

  /**
   * Fake all events except the specified ones
   *
   * All events will be faked except those in the provided array,
   * which will dispatch normally.
   *
   * @param events - Events that should NOT be faked
   * @returns EventFake instance for assertions
   *
   * @example
   * ```typescript
   * // Fake all events except UserDeleted
   * Event.fakeExcept([UserDeleted]);
   * // UserDeleted will dispatch normally, all others will be faked
   * ```
   */
  static fakeExcept(events: (string | (new (...args: any[]) => EventClass))[]): EventFake {
    const app = this.getFacadeApplication();
    const fake = new EventFake(app);

    const eventNames = events.map((e) => (typeof e === 'string' ? e : e.name));
    fake.setExceptedEvents(eventNames);

    // Store original dispatcher for pass-through
    try {
      const originalDispatcher = app.make<Dispatcher>('events');
      fake.setOriginalDispatcher(originalDispatcher);
    } catch (error) {
      // Dispatcher not registered yet, that's okay
    }

    // Replace the events binding with the fake
    app.instance('events', fake);
    this.clearResolvedInstance('events');

    return fake;
  }

  /**
   * Fake events only for the duration of a callback
   *
   * Temporarily replaces the event dispatcher with a fake, executes
   * the callback, then restores the original dispatcher. Useful for
   * scoping fakes to specific test blocks.
   *
   * @param callback - Function to execute with faked events
   * @returns Result of the callback and the fake instance
   *
   * @example
   * ```typescript
   * const [result, fake] = await Event.fakeFor(async () => {
   *   await someService.createUser();
   *   return 'done';
   * });
   *
   * fake.assertDispatched(UserRegistered);
   * expect(result).toBe('done');
   * ```
   */
  static async fakeFor<T>(callback: (fake: EventFake) => T | Promise<T>): Promise<[T, EventFake]> {
    const app = this.getFacadeApplication();

    // Store the original binding
    const originalBinding = app.bound('events');
    let originalDispatcher: Dispatcher | undefined;

    if (originalBinding) {
      try {
        originalDispatcher = app.make<Dispatcher>('events');
      } catch (error) {
        // Ignore if can't resolve
      }
    }

    // Create and install fake
    const fake = this.fake();

    try {
      const result = await callback(fake);
      return [result, fake];
    } finally {
      // Restore original dispatcher
      if (originalDispatcher) {
        app.instance('events', originalDispatcher);
      } else {
        // Re-register the singleton binding
        const { Dispatcher } = await import('@/Events/Dispatcher');
        app.singleton('events', (container: any) => new Dispatcher(container));
      }
      this.clearResolvedInstance('events');
    }
  }

  /**
   * Assert that an event was dispatched
   *
   * Can only be called after Event.fake() has been called.
   *
   * @param event - The event name or class
   * @param callback - Optional callback to filter events
   *
   * @example
   * ```typescript
   * Event.fake();
   * // Your code
   * Event.assertDispatched(UserRegistered);
   * Event.assertDispatched(UserRegistered, (event) => event.user.email === 'test@example.com');
   * ```
   */
  static assertDispatched(
    event: string | (new (...args: any[]) => EventClass),
    callback?: (event: EventClass) => boolean
  ): void {
    const fake = this.getFakeInstance();
    fake.assertDispatched(event, callback);
  }

  /**
   * Assert that an event was NOT dispatched
   *
   * Can only be called after Event.fake() has been called.
   *
   * @param event - The event name or class
   * @param callback - Optional callback to filter events
   *
   * @example
   * ```typescript
   * Event.fake();
   * // Your code
   * Event.assertNotDispatched(UserDeleted);
   * ```
   */
  static assertNotDispatched(
    event: string | (new (...args: any[]) => EventClass),
    callback?: (event: EventClass) => boolean
  ): void {
    const fake = this.getFakeInstance();
    fake.assertNotDispatched(event, callback);
  }

  /**
   * Assert that an event was dispatched a specific number of times
   *
   * Can only be called after Event.fake() has been called.
   *
   * @param event - The event name or class
   * @param times - Expected number of dispatches
   *
   * @example
   * ```typescript
   * Event.fake();
   * // Your code
   * Event.assertDispatchedTimes(UserRegistered, 3);
   * ```
   */
  static assertDispatchedTimes(event: string | (new (...args: any[]) => EventClass), times: number): void {
    const fake = this.getFakeInstance();
    fake.assertDispatchedTimes(event, times);
  }

  /**
   * Assert that no events were dispatched
   *
   * Can only be called after Event.fake() has been called.
   *
   * @example
   * ```typescript
   * Event.fake();
   * // Your code that shouldn't dispatch events
   * Event.assertNothingDispatched();
   * ```
   */
  static assertNothingDispatched(): void {
    const fake = this.getFakeInstance();
    fake.assertNothingDispatched();
  }

  /**
   * Assert that a listener is registered for an event
   *
   * @param event - The event name or class
   * @param listener - Optional specific listener to check for
   *
   * @example
   * ```typescript
   * Event.fake();
   * Event.listen(UserRegistered, SendWelcomeEmail);
   * Event.assertListening(UserRegistered);
   * Event.assertListening(UserRegistered, SendWelcomeEmail);
   * ```
   */
  static assertListening(
    event: string | (new (...args: any[]) => EventClass),
    listener?: string | EventListener
  ): void {
    const fake = this.getFakeInstance();
    fake.assertListening(event, listener);
  }

  /**
   * Get the fake instance
   *
   * @returns The EventFake instance
   * @throws Error if Event.fake() hasn't been called
   */
  protected static getFakeInstance(): EventFake {
    const app = this.getFacadeApplication();
    const instance = app.make<EventFake>('events');

    if (!(instance instanceof EventFake)) {
      throw new Error('Event facade is not faked. Call Event.fake() before making assertions.');
    }

    return instance;
  }

  /**
   * Check if the event dispatcher is currently faked
   *
   * @returns true if using EventFake
   */
  static isFaked(): boolean {
    try {
      const app = this.getFacadeApplication();
      const instance = app.make('events');
      return instance instanceof EventFake;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Export facade with Proxy for static method calls
 */
export const Event = new Proxy(EventFacadeClass, {
  get(target, prop) {
    // First check if it's a static method on the facade class itself
    if (prop in target) {
      const value = (target as any)[prop];
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    }

    // Then try to get from the facade root (the actual Dispatcher instance)
    try {
      const root = (target as any).getFacadeRoot();
      if (root && prop in root) {
        const value = root[prop];
        if (typeof value === 'function') {
          return (...args: any[]) => value.apply(root, args);
        }
        return value;
      }
    } catch (error) {
      // Facade root not available yet, that's okay
    }

    return undefined;
  },
}) as unknown as typeof EventFacadeClass & Dispatcher;

/**
 * Re-export EventFake for direct use
 */
export { EventFake };
