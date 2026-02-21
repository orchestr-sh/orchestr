import { Application } from '@/Foundation/Application';
import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import 'reflect-metadata';

/**
 * EventDiscovery
 *
 * Automatically discovers event listeners by scanning directories for listener files
 * and extracting event type information using TypeScript's reflect-metadata.
 *
 * This enables Laravel 11's automatic listener discovery feature where listeners
 * are automatically registered based on their type hints without manual registration.
 *
 * @example
 * ```typescript
 * const discovery = new EventDiscovery(app)
 * const listeners = await discovery.discover([app.path('Listeners')])
 * // Returns: Map<string, string[]> - event names to listener class paths
 * ```
 */
export class EventDiscovery {
  constructor(protected app: Application) {}

  /**
   * Discover all event listeners within the given directories
   *
   * Scans each directory recursively, loads listener classes, extracts their
   * event type hints, and builds a map of events to their listeners.
   *
   * @param directories Array of absolute paths to directories to scan
   * @returns Map of event names to listener class paths
   *
   * @example
   * ```typescript
   * const listeners = await discovery.discover([
   *   '/app/Listeners',
   *   '/app/Modules/User/Listeners'
   * ])
   * ```
   */
  async discover(directories: string[]): Promise<Map<string, string[]>> {
    const listeners = new Map<string, string[]>();

    for (const directory of directories) {
      const discovered = await this.discoverInDirectory(directory);

      // Merge discovered listeners
      for (const [event, listenerList] of discovered) {
        if (!listeners.has(event)) {
          listeners.set(event, []);
        }
        listeners.get(event)!.push(...listenerList);
      }
    }

    return listeners;
  }

  /**
   * Discover listeners in a single directory
   *
   * Recursively scans the directory for TypeScript/JavaScript files,
   * loads each file, and extracts event-listener mappings.
   *
   * @param directory Absolute path to directory to scan
   * @returns Map of event names to listener class paths for this directory
   */
  protected async discoverInDirectory(directory: string): Promise<Map<string, string[]>> {
    const listeners = new Map<string, string[]>();

    if (!this.directoryExists(directory)) {
      return listeners;
    }

    const files = this.getListenerFiles(directory);

    for (const file of files) {
      try {
        const listenerClass = await this.loadListenerClass(file);

        if (!listenerClass) continue;

        const events = this.extractEventTypes(listenerClass);

        for (const event of events) {
          if (!listeners.has(event)) {
            listeners.set(event, []);
          }
          listeners.get(event)!.push(this.getListenerName(file));
        }
      } catch (error) {
        // Skip files that can't be loaded
        if (this.app.isDebug()) {
          console.warn(`Could not load listener from ${file}:`, error);
        }
      }
    }

    return listeners;
  }

  /**
   * Get all TypeScript/JavaScript files in directory recursively
   *
   * Walks the directory tree and collects all valid listener files,
   * excluding test files and index files.
   *
   * @param directory Directory to scan
   * @param files Accumulator for recursive scanning
   * @returns Array of absolute file paths
   */
  protected getListenerFiles(directory: string, files: string[] = []): string[] {
    const entries = readdirSync(directory);

    for (const entry of entries) {
      const fullPath = join(directory, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        this.getListenerFiles(fullPath, files);
      } else if (this.isListenerFile(fullPath)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Check if file is a valid listener file
   *
   * Valid listener files:
   * - Must be .ts or .js
   * - Cannot be test files (.test.ts, .spec.ts)
   * - Cannot be index files (index.ts, index.js)
   *
   * @param file Absolute path to file
   * @returns True if file should be processed as a listener
   */
  protected isListenerFile(file: string): boolean {
    const ext = extname(file);

    // Must be .ts or .js file
    if (ext !== '.ts' && ext !== '.js') {
      return false;
    }

    // Exclude test files
    if (file.includes('.test.') || file.includes('.spec.')) {
      return false;
    }

    // Exclude index files
    if (file.endsWith('index.ts') || file.endsWith('index.js')) {
      return false;
    }

    return true;
  }

  /**
   * Load listener class from file
   *
   * Dynamically imports the file and attempts to find a valid listener class
   * from either the default export or named exports.
   *
   * @param file Absolute path to listener file
   * @returns Listener class constructor or undefined if not found
   */
  protected async loadListenerClass(file: string): Promise<any> {
    const module = await import(file);

    // Try to find the default export or named export
    return (
      module.default || Object.values(module).find((exp) => typeof exp === 'function' && this.isListenerClass(exp))
    );
  }

  /**
   * Check if a class is a listener
   *
   * A valid listener must have either a `handle` method or `__invoke` method
   * on its prototype.
   *
   * @param cls Class constructor to check
   * @returns True if class is a valid listener
   */
  protected isListenerClass(cls: any): boolean {
    if (typeof cls !== 'function') return false;

    // Must have a handle method or implement __invoke
    const prototype = cls.prototype;
    return typeof prototype?.handle === 'function' || typeof prototype?.__invoke === 'function';
  }

  /**
   * Extract event types from listener class
   *
   * Uses reflect-metadata to inspect the listener's handle method and extract
   * the event type from the first parameter. Also checks for the @HandlesEvents
   * decorator for union types.
   *
   * TypeScript's emitDecoratorMetadata must be enabled in tsconfig.json.
   *
   * @param listenerClass Listener class constructor
   * @returns Array of event class names this listener handles
   *
   * @example
   * ```typescript
   * // For: handle(event: UserRegistered)
   * // Returns: ['UserRegistered']
   *
   * // For: @HandlesEvents([UserRegistered, UserUpdated])
   * // Returns: ['UserRegistered', 'UserUpdated']
   * ```
   */
  protected extractEventTypes(listenerClass: any): string[] {
    const events: string[] = [];

    // Get the handle method
    const handleMethod = listenerClass.prototype.handle || listenerClass.prototype.__invoke;

    if (!handleMethod) return events;

    // Use reflect-metadata to get parameter types
    const paramTypes =
      Reflect.getMetadata('design:paramtypes', listenerClass.prototype, 'handle') ||
      Reflect.getMetadata('design:paramtypes', listenerClass.prototype, '__invoke');

    if (!paramTypes || paramTypes.length === 0) return events;

    // First parameter should be the event
    const eventType = paramTypes[0];

    if (eventType && eventType.name && eventType.name !== 'Object') {
      events.push(eventType.name);
    }

    // Check for union types (TypeScript limitation - requires custom decorator)
    // The @HandlesEvents decorator can be used to specify multiple event types
    const unionTypes = Reflect.getMetadata('event:types', listenerClass);
    if (unionTypes && Array.isArray(unionTypes)) {
      events.push(...unionTypes.map((t: any) => t.name));
    }

    return events;
  }

  /**
   * Get listener name from file path
   *
   * Converts an absolute file path to a listener class reference string
   * that can be used for container resolution.
   *
   * @param file Absolute path to listener file
   * @returns Listener class path relative to app directory
   *
   * @example
   * ```typescript
   * // Input: /app/Listeners/SendWelcomeEmail.ts
   * // Output: Listeners/SendWelcomeEmail
   *
   * // Input: /app/Modules/User/Listeners/NotifyAdmin.ts
   * // Output: Modules/User/Listeners/NotifyAdmin
   * ```
   */
  protected getListenerName(file: string): string {
    // Convert file path to class name
    // Remove extension
    let name = file.replace(/\.[jt]s$/, '');

    // Get relative to app path
    const appPath = this.app.path();
    if (name.startsWith(appPath)) {
      name = name.substring(appPath.length + 1);
    }

    // Convert to class path (e.g., Listeners/SendWelcomeEmail)
    return name;
  }

  /**
   * Check if directory exists
   *
   * @param directory Absolute path to directory
   * @returns True if directory exists and is accessible
   */
  protected directoryExists(directory: string): boolean {
    try {
      return statSync(directory).isDirectory();
    } catch {
      return false;
    }
  }
}
