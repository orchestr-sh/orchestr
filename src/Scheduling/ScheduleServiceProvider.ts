/**
 * ScheduleServiceProvider
 *
 * Registers the task scheduler into the container.
 * Mirrors Laravel's `Illuminate\Console\Scheduling\ScheduleServiceProvider`,
 * where the concrete `Schedule` is resolved through the container so
 * `schedule:run` and any `Schedule` facade access share one registry.
 */

import { ServiceProvider } from '@/Foundation/ServiceProvider';
import { Schedule } from './Schedule';

export class ScheduleServiceProvider extends ServiceProvider {
  /**
   * Register scheduler services
   */
  register(): void {
    this.app.singleton('schedule', () => new Schedule(this.app));
    this.app.alias('schedule', Schedule);
  }
}
