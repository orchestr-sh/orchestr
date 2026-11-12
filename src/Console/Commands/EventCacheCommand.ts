/**
 * EventCacheCommand
 *
 * Discover and cache the application's events and listeners following Laravel's Artisan pattern
 */

import { Command } from '@/Console/Command';
import { EventDiscoveryCache } from '@/Events/EventDiscoveryCache';
import { registerListener } from '@/Events/ListenerRegistry';
import { Application } from '@/Foundation/Application';

export class EventCacheCommand extends Command {
  signature = 'event:cache';
  description = "Discover and cache the application's events and listeners";

  constructor(protected app: Application) {
    super();
  }

  async handle(): Promise<void> {
    this.info('Discovering events and listeners...');

    const { EventDiscovery } = await import('@/Support/EventDiscovery');

    const discovery = new EventDiscovery(this.app);
    const directories = this.app.getEventDiscoveryPaths();

    this.comment(`Scanning directories:`);
    directories.forEach((dir) => this.comment(`  - ${dir}`));
    this.newLine();

    const listeners = await discovery.discover(directories);
    const classes = discovery.getDiscoveredClasses();

    // Registering the loaded classes keeps cached string listeners resolvable
    // in this process (dispatcher fallback + queued listener jobs).
    for (const [name, listenerClass] of classes) {
      registerListener(name, listenerClass);
    }

    if (listeners.size === 0) {
      this.warn('No events discovered.');
      return;
    }

    // Persist through the shared cache store so EventServiceProvider boot and
    // event:clear read exactly the same format.
    const cache = new EventDiscoveryCache(this.app);
    const cachePath = cache.getCachePath();

    if (!cache.store(listeners)) {
      this.error(`Failed to write the event cache to: ${cachePath}`);
      return;
    }

    this.info(`Events cached successfully!`);
    this.newLine();
    this.comment(`Cached ${listeners.size} events to: ${cachePath}`);

    // Show summary
    let totalListeners = 0;
    for (const [, listenerList] of listeners) {
      totalListeners += listenerList.length;
    }

    this.comment(`Total listeners: ${totalListeners}`);
  }
}
