/**
 * DownCommand
 *
 * Put the application into maintenance mode by recording its state through
 * `Application.maintenanceMode()` - the single storage the maintenance
 * middleware, the queue worker and the scheduler read (DRY).
 *
 * Mirrors Laravel's `php artisan down`: the message shown while down, the
 * Retry-After lifetime, a secret token visitors can arrive with to bypass
 * the wall, and a view name the middleware renders for HTML requests.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { MaintenanceModeData } from '@/Foundation/MaintenanceMode';

export class DownCommand extends Command {
  signature =
    'down {--message= : The message that should be shown to users while the application is down}' +
    ' {--retry= : Number of seconds the server should ask clients to wait before retrying}' +
    ' {--secret= : The token that lets visitors bypass maintenance mode}' +
    ' {--render= : The view that should be rendered for HTML requests while down}';
  description = 'Put the application into maintenance / demo mode';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[] = [], options: CommandOptions = {}): Promise<void> {
    const data: MaintenanceModeData = {
      message: textValue(options.message),
      secret: textValue(options.secret),
      render: textValue(options.render),
    };

    if (typeof options.retry === 'string' || typeof options.retry === 'number') {
      const retry = Number(options.retry);

      if (!Number.isFinite(retry) || retry < 0) {
        this.error('The [retry] option must be a non-negative number of seconds.');

        return;
      }

      data.retry = Math.floor(retry);
    }

    this.app.maintenanceMode().activate(data);

    this.info('Application now in maintenance mode.');

    if (data.secret) {
      this.comment(`Please visit the application with the secret to bypass maintenance: ?secret=${data.secret}`);
    }
  }
}

/**
 * An option value carrying text; absent or value-less flags answer
 * undefined so nothing is recorded
 */
function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
