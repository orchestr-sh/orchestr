/**
 * DB Facade
 *
 * Provides static access to the DatabaseManager
 */

import { Facade } from '../Support/Facade';
import { DatabaseManager } from '../Database/DatabaseManager';

class DBFacade extends Facade {
  protected static getFacadeAccessor(): string {
    return 'db';
  }
}

// Create proxy for static method access
export const DB = new Proxy(DBFacade, {
  get(target: any, prop: string) {
    // Get the resolved instance from the container
    const root = target.getFacadeRoot() as DatabaseManager;

    if (!root) {
      throw new Error('DB Facade: Database manager not found in container. Did you register DatabaseServiceProvider?');
    }

    // If accessing a method/property on DatabaseManager
    if (root && typeof (root as any)[prop] === 'function') {
      return (...args: any[]) => (root as any)[prop](...args);
    }

    if (root && prop in root) {
      return (root as any)[prop];
    }

    // Default table() shortcut - get connection and call table()
    if (prop === 'table') {
      return (tableName: string) => root.connection().table(tableName);
    }

    // Proxy other methods to the default connection
    const connection = root.connection();

    if (connection && typeof (connection as any)[prop] === 'function') {
      return (...args: any[]) => (connection as any)[prop](...args);
    }

    return (connection as any)?.[prop];
  },
});
