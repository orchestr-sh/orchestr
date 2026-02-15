/**
 * EventListCommand
 *
 * List all registered events and their listeners following Laravel's Artisan pattern
 */

import { Command, CommandOptions } from '../Command';
import { Application } from '../../Foundation/Application';

export class EventListCommand extends Command {
  signature = 'event:list [--event=]';
  description = 'List the application\'s events and listeners';

  constructor(protected app: Application) {
    super();
  }

  async handle(args: string[], options: CommandOptions): Promise<void> {
    try {
      // Try to get the dispatcher - will fail gracefully if not available yet
      const dispatcher = this.app.make<any>('events');
      const listeners = dispatcher.getRawListeners();

      if (listeners.size === 0) {
        this.comment('No events have been registered.');
        return;
      }

      const filter = options.event as string | undefined;

      const rows: string[][] = [];

      for (const [event, listenerList] of listeners) {
        // Filter if event option provided
        if (filter && !event.includes(filter)) {
          continue;
        }

        if (listenerList.length === 0) {
          rows.push([event, 'No listeners']);
        } else {
          listenerList.forEach((listener: any, index: number) => {
            rows.push([
              index === 0 ? event : '',
              this.formatListener(listener)
            ]);
          });
        }

        // Add separator between events
        if (rows.length > 0 && rows[rows.length - 1][0] !== '') {
          rows.push(['', '']);
        }
      }

      // Remove trailing separator
      if (rows.length > 0 && rows[rows.length - 1][0] === '') {
        rows.pop();
      }

      if (rows.length === 0) {
        this.comment(`No events found matching: ${filter}`);
        return;
      }

      this.newLine();
      this.info('Registered Events and Listeners:');
      this.newLine();

      // Display results in a formatted table
      const maxEventLength = Math.max(
        ...rows.map(row => row[0].length),
        'Event'.length
      );
      const maxListenerLength = Math.max(
        ...rows.map(row => row[1].length),
        'Listeners'.length
      );

      // Header
      this.line(
        `${'Event'.padEnd(maxEventLength + 2)} ${'Listeners'.padEnd(maxListenerLength)}`
      );
      this.line('-'.repeat(maxEventLength + maxListenerLength + 3));

      // Rows
      for (const [event, listener] of rows) {
        if (event === '' && listener === '') {
          this.line('');
        } else {
          this.line(
            `${event.padEnd(maxEventLength + 2)} ${listener}`
          );
        }
      }

      this.newLine();
      this.comment(`Total events: ${listeners.size}`);
    } catch (error: any) {
      if (error.message?.includes('events')) {
        this.error('Event dispatcher not registered.');
        this.comment('Make sure the EventServiceProvider is registered in your application.');
      } else {
        throw error;
      }
    }
  }

  /**
   * Format a listener for display
   */
  protected formatListener(listener: any): string {
    if (typeof listener === 'string') {
      return listener;
    }

    if (typeof listener === 'function') {
      return listener.name || '<Closure>';
    }

    if (typeof listener === 'object' && listener.constructor) {
      return listener.constructor.name;
    }

    return '<Unknown>';
  }
}
