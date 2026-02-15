import 'reflect-metadata';

/**
 * HandlesEvents Decorator
 *
 * Decorator to explicitly specify which events a listener handles.
 * This is particularly useful for:
 * - Union types (TypeScript can't reflect union type information at runtime)
 * - Multiple events handled by a single listener
 * - Clarifying listener behavior
 *
 * The decorator stores the event types in metadata that can be read by
 * the EventDiscovery system during listener scanning.
 *
 * @param events Array of event class constructors this listener handles
 * @returns Class decorator function
 *
 * @example
 * ```typescript
 * import { HandlesEvents } from '@orchestr/Events/Decorators/HandlesEvents'
 * import { UserRegistered } from '../Events/UserRegistered'
 * import { UserUpdated } from '../Events/UserUpdated'
 *
 * // Single event
 * @HandlesEvents([UserRegistered])
 * class SendWelcomeEmail {
 *   handle(event: UserRegistered) {
 *     // Send welcome email
 *   }
 * }
 *
 * // Multiple events (union type)
 * @HandlesEvents([UserRegistered, UserUpdated])
 * class UserNotificationListener {
 *   handle(event: UserRegistered | UserUpdated) {
 *     if (event instanceof UserRegistered) {
 *       // Handle registration
 *     } else {
 *       // Handle update
 *     }
 *   }
 * }
 *
 * // With ShouldQueue
 * @HandlesEvents([OrderPlaced])
 * class ProcessOrderListener implements ShouldQueue {
 *   public queue = 'orders'
 *
 *   async handle(event: OrderPlaced) {
 *     // Process order
 *   }
 * }
 * ```
 */
export function HandlesEvents(events: Function[]): ClassDecorator {
  return function (target: any) {
    // Store event types in metadata
    // This metadata is read by EventDiscovery.extractEventTypes()
    Reflect.defineMetadata('event:types', events, target);

    return target;
  };
}

/**
 * Type guard to check if a class has the HandlesEvents decorator
 *
 * @param target Class to check
 * @returns True if class has HandlesEvents metadata
 *
 * @example
 * ```typescript
 * if (hasHandlesEventsMetadata(MyListener)) {
 *   const events = getHandledEvents(MyListener)
 *   console.log('Listener handles:', events)
 * }
 * ```
 */
export function hasHandlesEventsMetadata(target: any): boolean {
  if (typeof target !== 'function') return false;

  const metadata = Reflect.getMetadata('event:types', target);
  return metadata !== undefined && Array.isArray(metadata);
}

/**
 * Get the event types from a listener class decorated with @HandlesEvents
 *
 * @param target Listener class constructor
 * @returns Array of event class constructors, or empty array if not decorated
 *
 * @example
 * ```typescript
 * const events = getHandledEvents(SendWelcomeEmail)
 * // Returns: [UserRegistered]
 * ```
 */
export function getHandledEvents(target: any): Function[] {
  if (!hasHandlesEventsMetadata(target)) {
    return [];
  }

  return Reflect.getMetadata('event:types', target) || [];
}
