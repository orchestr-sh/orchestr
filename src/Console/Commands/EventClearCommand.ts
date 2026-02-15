/**
 * EventClearCommand
 *
 * Clear all cached events and listeners following Laravel's Artisan pattern
 */

import { Command } from '../Command';
import { Application } from '../../Foundation/Application';
import * as fs from 'fs/promises';

export class EventClearCommand extends Command {
  signature = 'event:clear';
  description = 'Clear all cached events and listeners';

  constructor(protected app: Application) {
    super();
  }

  async handle(): Promise<void> {
    const cachePath = this.app.storagePath('framework/events.json');

    try {
      await fs.access(cachePath);
      await fs.unlink(cachePath);
      this.info('Cached events cleared successfully.');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.comment('No cached events found.');
      } else {
        this.error(`Failed to clear cached events: ${error.message}`);
        throw error;
      }
    }
  }
}
