/**
 * MaintenanceMode - the application's maintenance state
 * Illuminate\Foundation\MaintenanceMode (file driver)
 *
 * The single owner of where maintenance lives and how it is
 * (de)serialised: `storage/framework/down`, written by `orchestr down` and
 * removed by `orchestr up`. Everything that needs to know - the
 * PreventRequestsDuringMaintenance middleware, the queue worker, the
 * scheduler - reads it through `Application.isDownForMaintenance()` /
 * `Application.maintenanceMode()` instead of touching the file itself
 * (DRY).
 *
 * A stateless down file (the old `touch storage/framework/down` idiom) is
 * still "down" - just `decommissioned()`, carrying no secret, message or
 * view data.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { Application } from './Application';

/**
 * What `orchestr down` records alongside the maintenance state
 * Laravel: Illuminate\Foundation\Console\Concerns\WritesMaintenanceRules /
 * MaintenanceModeData
 */
export interface MaintenanceModeData {
  /**
   * The message shown to visitors while the application is down
   */
  message?: string;

  /**
   * Seconds the `Retry-After` header asks clients to wait before retrying
   */
  retry?: number;

  /**
   * A token that lets requests carrying it (query string or cookie) through
   */
  secret?: string;

  /**
   * A view name rendered (instead of the plain message) for HTML requests
   */
  render?: string;

  /**
   * Epoch seconds of when maintenance mode was activated
   */
  time?: number;

  [key: string]: unknown;
}

export class MaintenanceMode {
  constructor(protected app: Application) {}

  /**
   * The path of the down file holding the maintenance state
   * Laravel: storage_path('framework/down')
   */
  path(): string {
    return this.app.storagePath('framework/down');
  }

  /**
   * Determine whether the application is currently down for maintenance
   */
  active(): boolean {
    try {
      return existsSync(this.path());
    } catch {
      return false;
    }
  }

  /**
   * Determine whether maintenance is active but carries no data - a down
   * file created outside `orchestr down` (or by an older release), which
   * can block traffic but has no secret to bypass or message to show
   */
  decommissioned(): boolean {
    return this.active() && Object.keys(this.data()).length === 0;
  }

  /**
   * The data recorded when maintenance mode was activated; an empty object
   * when the application is not down or the file holds nothing parsable
   * Laravel: MaintenanceMode::data()
   */
  data(): MaintenanceModeData {
    try {
      const contents = readFileSync(this.path(), 'utf8').trim();

      if (contents === '') {
        return {};
      }

      const parsed = JSON.parse(contents);

      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as MaintenanceModeData)
        : {};
    } catch {
      return {};
    }
  }

  /**
   * Determine whether a secret token guards the maintenance-mode bypass
   */
  hasSecret(): boolean {
    const { secret } = this.data();

    return typeof secret === 'string' && secret !== '';
  }

  /**
   * Put the application into maintenance mode
   * Laravel: php artisan down
   */
  activate(data: MaintenanceModeData = {}): void {
    const path = this.path();

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ ...data, time: Math.floor(Date.now() / 1000) }), 'utf8');
  }

  /**
   * Take the application out of maintenance mode; succeeding when it was
   * not down at all
   * Laravel: php artisan up
   */
  deactivate(): void {
    rmSync(this.path(), { force: true });
  }
}
