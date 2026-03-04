/**
 * DeployRollbackCommand
 *
 * Roll back the current project to its previous active deployment.
 * Signature: deploy:rollback
 */

import { Command, CommandOptions } from '@/Console/Command';
import { CredentialStore } from '@/Deploy/CredentialStore';
import { ProjectConfig } from '@/Deploy/ProjectConfig';
import { SymphonyClient } from '@/Deploy/SymphonyClient';
import { prompt } from '@/Deploy/prompt';

export class DeployRollbackCommand extends Command {
  signature = 'deploy:rollback';
  description = 'Roll back to the previous active deployment';

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

    const client = new SymphonyClient(credentials.api, credentials.token);

    // Confirm unless --force
    if (!options.force) {
      this.warn(`You are about to roll back project "${config.project}".`);
      const confirm = await prompt('Are you sure? (y/N): ');
      if (confirm.toLowerCase() !== 'y') {
        this.comment('Rollback cancelled.');
        return;
      }
    }

    try {
      this.comment('Initiating rollback...');
      const result = await client.rollback(config.project);

      this.newLine();
      this.info('Rollback successful.');
      this.comment(`  Rolled back: ${result.rolled_back.uuid}`);
      this.comment(`  Restored:    ${result.restored.uuid}`);
      this.newLine();
      this.warn('Note: The API record has been updated. If PM2 is running the old release,');
      this.warn('you may need to SSH in and re-symlink the release manually, or redeploy.');
    } catch (error: any) {
      if (error.status === 400) {
        this.error(error.message);
      } else {
        this.error(`Rollback failed: ${error.message}`);
      }
      process.exit(1);
    }
  }
}
