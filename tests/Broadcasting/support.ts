/**
 * Shared helpers for the Broadcasting test suites: a booted application with
 * the event, queue and broadcasting providers registered against a throwaway
 * base path, plus the config hooks the driver tests need.
 */

import { rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BroadcastManager } from '@/Broadcasting/BroadcastManager';
import { BroadcastServiceProvider } from '@/Broadcasting/BroadcastServiceProvider';
import { EventServiceProvider } from '@/Events/EventServiceProvider';
import { Application } from '@/Foundation/Application';
import { Config } from '@/Foundation/Config/Config';
import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { QueueServiceProvider } from '@/Queue/QueueServiceProvider';
import { Facade } from '@/Support/Facade';

let counter = 0;

export interface BroadcastTestApp {
  app: Application;
  config: Config;
  /** The booted BroadcastManager, resolved from the container. */
  manager: BroadcastManager;
  /** Root of the temporary application directory. */
  base: string;
  cleanup(): Promise<void>;
}

export interface BroadcastTestOptions {
  /** Values layered over the default `broadcasting` config section. */
  broadcasting?: Record<string, any>;
  /** Values layered over the default `queue` config section. */
  queue?: Record<string, any>;
  /** Extra top-level config keys. */
  config?: Record<string, any>;
}

export async function createBroadcastApp(options: BroadcastTestOptions = {}): Promise<BroadcastTestApp> {
  const base = join(tmpdir(), `orchestr-broadcast-tests-${process.pid}-${Date.now()}-${counter++}`);
  mkdirSync(base, { recursive: true });

  const config = new Config({
    app: { name: 'Broadcast Test' },
    queue: { default: 'sync', connections: { sync: { driver: 'sync' } } },
    broadcasting: {
      default: 'log',
      connections: {
        log: { driver: 'log' },
        null: { driver: 'null' },
      },
      ...options.broadcasting,
    },
    ...options.config,
  });

  if (options.queue) {
    config.set('queue', { ...config.get<Record<string, any>>('queue', {}), ...options.queue });
  }

  const app = new Application(base);
  app.instance('config', config);

  Facade.setFacadeApplication(app);
  Facade.clearResolvedInstances();

  app.register(EventServiceProvider as unknown as new (application: Application) => ServiceProvider);
  app.register(QueueServiceProvider);
  app.register(BroadcastServiceProvider);

  await app.boot();

  const manager = app.make<BroadcastManager>('broadcast');

  return {
    app,
    config,
    manager,
    base,
    async cleanup(): Promise<void> {
      Facade.clearResolvedInstances();
      Facade.setFacadeApplication(undefined as unknown as Application);
      rmSync(base, { recursive: true, force: true });
    },
  };
}
