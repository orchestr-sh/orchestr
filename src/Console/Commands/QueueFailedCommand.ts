/**
 * QueueFailedCommand
 *
 * List all of the failed queue jobs.
 * Mirrors Laravel's `php artisan queue:failed`.
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import type { FailedJobProvider } from '@/Queue/Failed/FailedJobProvider';

export class QueueFailedCommand extends Command {
  signature = 'queue:failed';
  description = 'List all of the failed queue jobs';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[], _options: CommandOptions): Promise<void> {
    const failer = this.getFailedJobProvider();

    if (!failer) {
      this.error('No failed job provider configured.');
      return;
    }

    const failedJobs = await failer.all();

    if (failedJobs.length === 0) {
      this.info('No failed jobs found.');
      return;
    }

    this.info(`Found ${failedJobs.length} failed job(s):`);
    this.newLine();

    const headers = ['ID', 'UUID', 'Connection', 'Queue', 'Job', 'Failed At'];
    const rows = failedJobs.map((job) => {
      let jobName = 'Unknown';
      try {
        const payload = JSON.parse(job.payload);
        jobName = payload.displayName || payload.job || 'Unknown';
      } catch {
        // Invalid payload
      }

      return [String(job.id), job.uuid.substring(0, 8) + '...', job.connection, job.queue, jobName, job.failed_at];
    });

    // Simple table output
    const colWidths = headers.map((h, i) => {
      const maxData = Math.max(...rows.map((r) => String(r[i]).length));
      return Math.max(h.length, maxData);
    });

    const separator = colWidths.map((w) => '-'.repeat(w + 2)).join('+');
    const formatRow = (row: string[]) => row.map((cell, i) => ` ${String(cell).padEnd(colWidths[i])} `).join('|');

    this.line(separator);
    this.line(formatRow(headers));
    this.line(separator);
    for (const row of rows) {
      this.line(formatRow(row));
    }
    this.line(separator);
  }

  protected getFailedJobProvider(): FailedJobProvider | null {
    try {
      return this.app.make<FailedJobProvider>('queue.failer');
    } catch {
      return null;
    }
  }
}
