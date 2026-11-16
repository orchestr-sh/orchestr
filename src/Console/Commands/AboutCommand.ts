/**
 * AboutCommand
 *
 * Print a snapshot of the application: framework version, environment, and
 * the drivers plus configuration of the cache, database, queue, filesystem,
 * and session subsystems. Mirrors Laravel's `php artisan about`.
 *
 * The report content lives in ApplicationDiagnostics; this command just
 * lays the sections out.
 */

import type { AboutSection } from '@/Foundation/Diagnostics/ApplicationDiagnostics';
import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { ApplicationDiagnostics } from '@/Foundation/Diagnostics/ApplicationDiagnostics';

export class AboutCommand extends Command {
  signature = 'about';
  description = 'Display basic information about the application';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[] = [], _options: CommandOptions = {}): Promise<void> {
    await this.app.boot();

    const sections = new ApplicationDiagnostics(this.app).collect();

    this.info(`Orchestr ${this.app.version()}`);

    for (const section of sections) {
      this.renderSection(section);
    }
  }

  private renderSection(section: AboutSection): void {
    this.newLine();
    this.comment(`${section.title}`);
    this.newLine();

    const width = Math.max(...section.rows.map(([label]) => label.length));

    for (const [label, value] of section.rows) {
      this.line(`  ${label.padEnd(width)} ${value}`);
    }
  }
}
