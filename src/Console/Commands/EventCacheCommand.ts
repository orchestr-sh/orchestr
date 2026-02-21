/**
 * EventCacheCommand
 *
 * Discover and cache the application's events and listeners following Laravel's Artisan pattern
 */

import { Command } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import * as fs from 'fs/promises';
import * as path from 'path';

export class EventCacheCommand extends Command {
  signature = 'event:cache';
  description = "Discover and cache the application's events and listeners";

  constructor(protected app: Application) {
    super();
  }

  async handle(): Promise<void> {
    this.info('Discovering events and listeners...');

    try {
      // Try to dynamically import EventDiscovery (Task 6 dependency)
      const { EventDiscovery } = await import('@/Support/EventDiscovery');

      const discovery = new EventDiscovery(this.app);
      const directories = this.app.getEventDiscoveryPaths();

      this.comment(`Scanning directories:`);
      directories.forEach((dir) => this.comment(`  - ${dir}`));
      this.newLine();

      const listeners = await discovery.discover(directories);

      if (listeners.size === 0) {
        this.warn('No events discovered.');
        return;
      }

      // Convert Map to array for JSON serialization
      const listenersArray = Array.from(listeners.entries());

      // Create cache directory
      const cachePath = this.app.storagePath('framework/events.json');
      await fs.mkdir(path.dirname(cachePath), { recursive: true });

      // Write cache file
      await fs.writeFile(cachePath, JSON.stringify(listenersArray, null, 2));

      this.info(`Events cached successfully!`);
      this.newLine();
      this.comment(`Cached ${listeners.size} events to: ${cachePath}`);

      // Show summary
      let totalListeners = 0;
      for (const [, listenerList] of listeners) {
        totalListeners += listenerList.length;
      }

      this.comment(`Total listeners: ${totalListeners}`);
    } catch (error: any) {
      if (error.code === 'MODULE_NOT_FOUND' && error.message?.includes('EventDiscovery')) {
        this.error('EventDiscovery module not found.');
        this.comment('The EventDiscovery system (Task 6) must be implemented first.');
        this.comment('This command will work once EventDiscovery is available.');
      } else {
        this.error(`Failed to cache events: ${error.message}`);
        throw error;
      }
    }
  }
}
