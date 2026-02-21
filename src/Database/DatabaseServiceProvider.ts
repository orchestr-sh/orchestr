/**
 * DatabaseServiceProvider
 *
 * Registers database services into the container
 */

import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { DatabaseManager } from './DatabaseManager';
import { DrizzleAdapter } from './Adapters/DrizzleAdapter';

export class DatabaseServiceProvider extends ServiceProvider {
  /**
   * Register database services
   */
  register(): void {
    this.app.singleton('db', () => {
      const config = (this.app.make('config') as any).items?.database || {
        default: 'sqlite',
        connections: {
          sqlite: {
            adapter: 'drizzle',
            driver: 'better-sqlite3',
            database: ':memory:',
          },
        },
      };

      const manager = new DatabaseManager(config);

      // Register Drizzle adapter
      manager.registerAdapter('drizzle', (config) => new DrizzleAdapter(config));

      return manager;
    });
  }

  /**
   * Boot database services
   */
  async boot(): Promise<void> {
    // Optionally auto-connect to the default connection
    // const db = this.app.make<DatabaseManager>('db');
    // await db.connection().connect();
  }
}
