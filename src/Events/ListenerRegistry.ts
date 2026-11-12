/**
 * Listener Registry
 *
 * A process-wide map of listener class names (or discovery paths) to the
 * listener constructors/instances that were handed to the dispatcher.
 *
 * Class strings survive queue serialization, but TypeScript classes do not,
 * so a worker resolving a `CallQueuedListener` job looks the handler up here
 * first and falls back to the service container. Discovery and manual
 * `listen()` registration both populate the registry, which keeps the queued
 * path working for listeners that are never explicitly container-bound.
 *
 * @example
 * ```typescript
 * registerListener('SendWelcomeEmail', SendWelcomeEmail);
 * const listener = resolveRegisteredListener('SendWelcomeEmail');
 * ```
 */
import type { EventListener } from './types';

const registry = new Map<string, EventListener>();

/**
 * Remember a listener class or instance under a stable name
 *
 * @param name - Listener class name / discovery path used by the worker to resolve the handler
 * @param listener - The constructor, instance, or string reference being registered
 */
export function registerListener(name: string, listener: EventListener): void {
  registry.set(name, listener);
}

/**
 * Look up a previously registered listener by name
 *
 * @param name - Listener class name / discovery path
 * @returns The registered listener, or undefined when unknown
 */
export function resolveRegisteredListener(name: string): EventListener | undefined {
  return registry.get(name);
}

/**
 * Clear the registry (used between test runs)
 */
export function clearListenerRegistry(): void {
  registry.clear();
}
