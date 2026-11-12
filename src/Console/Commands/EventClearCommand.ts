/**
 * EventClearCommand
 *
 * Clear all cached events and listeners following Laravel's Artisan pattern
 */

import { Command } from '@/Console/Command';
import { EventDiscoveryCache } from '@/Events/EventDiscoveryCache';
import { Application } from '@/Foundation/Application';

export class EventClearCommand extends Command {
  signature = 'event:clear';
  description = 'Clear all cached events and listeners';

  constructor(protected app: Application) {
    super();
  }

  async handle(): Promise<void> {
    const cache = new EventDiscoveryCache(this.app);

    if (!cache.exists()) {
      this.comment('No cached events found.');
      return;
    }

    if (cache.clear()) {
      this.info('Cached events cleared successfully.');
    } else {
      this.error(`Failed to clear cached events: ${cache.getCachePath()}`);
    }
  }
}
