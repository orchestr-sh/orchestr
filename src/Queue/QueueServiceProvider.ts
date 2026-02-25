/**
 * QueueServiceProvider
 *
 * Registers queue services into the container.
 * Mirrors Laravel's Illuminate\Queue\QueueServiceProvider.
 */

import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { QueueManager } from './QueueManager';
import type { QueueConfig } from './QueueManager';
import { SyncDriver } from './Drivers/SyncDriver';
import { DatabaseDriver } from './Drivers/DatabaseDriver';
import { NullDriver } from './Drivers/NullDriver';
import { Worker } from './Workers/Worker';
import { DatabaseFailedJobProvider } from './Failed/DatabaseFailedJobProvider';

export class QueueServiceProvider extends ServiceProvider {
  /**
   * Register queue services
   */
  register(): void {
    this.app.singleton('queue', () => {
      const config = this.getConfig();
      const manager = new QueueManager(config);

      // Register built-in drivers
      manager.registerDriver('sync', (driverConfig) => new SyncDriver(driverConfig));
      manager.registerDriver('database', (driverConfig) => new DatabaseDriver(driverConfig, this.app));
      manager.registerDriver('null', (driverConfig) => new NullDriver(driverConfig));

      return manager;
    });

    this.app.singleton('queue.worker', () => {
      const manager = this.app.make<QueueManager>('queue');
      return new Worker(manager, this.app);
    });

    this.app.singleton('queue.failer', () => {
      const config = this.getConfig();
      const failedConfig = config.failed || { driver: 'database', table: 'failed_jobs' };

      return new DatabaseFailedJobProvider(this.app, {
        table: failedConfig.table || 'failed_jobs',
        database: failedConfig.database,
      });
    });
  }

  /**
   * Get the queue configuration
   */
  protected getConfig(): QueueConfig {
    try {
      const configService = this.app.make('config') as any;
      const queueConfig = configService?.items?.queue || configService?.get?.('queue');
      if (queueConfig) {
        return queueConfig;
      }
    } catch {
      // Config service not available
    }

    // Default configuration
    return {
      default: 'sync',
      connections: {
        sync: {
          driver: 'sync',
        },
      },
      failed: {
        driver: 'database',
        database: 'sqlite',
        table: 'failed_jobs',
      },
    };
  }
}
