/**
 * DeployStatusCommand
 *
 * List recent deployments for the current project.
 * Signature: deploy:status
 * Options:   --limit=<n>
 */

import { Command, CommandOptions } from '@/Console/Command';
import { CredentialStore } from '@/Deploy/CredentialStore';
import { ProjectConfig } from '@/Deploy/ProjectConfig';
import { SymphonyClient } from '@/Deploy/SymphonyClient';

const STATUS_COLORS: Record<string, string> = {
  active: '\x1b[32m', // green
  failed: '\x1b[31m', // red
  rolled_back: '\x1b[33m', // yellow
  pending: '\x1b[90m', // grey
  building: '\x1b[36m', // cyan
  uploading: '\x1b[36m',
  deploying: '\x1b[36m',
};
const RESET = '\x1b[0m';

export class DeployStatusCommand extends Command {
  signature = 'deploy:status';
  description = 'Show recent deployments for the current project';

  async handle(_args: string[], options: CommandOptions): Promise<void> {
    const credentials = CredentialStore.load();
    if (!credentials) {
      this.error('Not authenticated. Run `orchestr deploy:login` first.');
      process.exit(1);
    }

    const config = ProjectConfig.load();
    if (!config) {
      this.error('No symphony.json found. Run `orchestr deploy:init` first.');
      process.exit(1);
    }

    const limit = parseInt(options.limit ?? '10', 10);
    const client = new SymphonyClient(credentials.api, credentials.token);

    try {
      const result = await client.listDeployments(config.project, 1, limit);
      const { deployments, pagination } = result;

      if (deployments.length === 0) {
        this.comment('No deployments yet.');
        return;
      }

      this.info(`Deployments for project: ${config.project}`);
      this.newLine();

      // Header
      this.line(`  ${'UUID'.padEnd(10)} ${'Status'.padEnd(14)} ${'Date'.padEnd(22)} ${'Commit'.padEnd(10)} Message`);
      this.line(`  ${'-'.repeat(80)}`);

      for (const d of deployments) {
        const status = d.status ?? 'unknown';
        const color = STATUS_COLORS[status] ?? '';
        const coloredStatus = `${color}${status.padEnd(12)}${RESET}`;
        const date = new Date(d.created_at).toLocaleString().padEnd(22);
        const hash = (d.commit_hash ?? '-').padEnd(10);
        const msg = d.commit_message ? d.commit_message.slice(0, 35) + (d.commit_message.length > 35 ? '…' : '') : '-';
        this.line(`  ${d.uuid.slice(0, 8).padEnd(10)} ${coloredStatus} ${date} ${hash} ${msg}`);
      }

      this.newLine();
      this.comment(`Showing ${deployments.length} of ${pagination.total} deployments.`);
    } catch (error: any) {
      this.error(`Failed to fetch deployments: ${error.message}`);
      process.exit(1);
    }
  }
}
