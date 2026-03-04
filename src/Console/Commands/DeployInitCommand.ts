/**
 * DeployInitCommand
 *
 * Interactive setup: authenticate if needed, prompt for project name,
 * create project via API, write symphony.json to project root.
 * Signature: deploy:init
 */

import { Command, CommandOptions } from '@/Console/Command';
import { CredentialStore } from '@/Deploy/CredentialStore';
import { ProjectConfig } from '@/Deploy/ProjectConfig';
import { SymphonyClient } from '@/Deploy/SymphonyClient';
import { prompt } from '@/Deploy/prompt';

export class DeployInitCommand extends Command {
  signature = 'deploy:init [--name=] [--repository=] [--yes]';
  description = 'Initialise a Symphony deployment for this project';

  options: { name?: string; repository?: string; yes?: boolean } = {};

  async handle(_args: string[], options: CommandOptions): Promise<void> {
    this.options = {
      name: options.name as string | undefined,
      repository: options.repository as string | undefined,
      yes: options.yes as boolean | undefined,
    };

    this.info('Symphony — Initialise Project');
    this.newLine();

    const credentials = CredentialStore.load();
    if (!credentials) {
      this.error('Not authenticated. Run `orchestr deploy:login` first.');
      process.exit(1);
    }

    const client = new SymphonyClient(credentials.api, credentials.token);

    if (ProjectConfig.exists()) {
      const existing = ProjectConfig.load();
      if (!this.options.yes) {
        this.warn(`symphony.json already exists (project: ${existing?.project}).`);
        const overwrite = await prompt('Overwrite? (y/N): ');
        if (overwrite.toLowerCase() !== 'y') {
          this.comment('Aborted.');
          return;
        }
      }
    }

    let name: string;
    if (this.options.name) {
      name = this.options.name;
    } else {
      name = await prompt('Project name: ');
    }
    if (!name.trim()) {
      this.error('Project name is required.');
      process.exit(1);
    }

    let repository: string = '';
    if (this.options.repository) {
      repository = this.options.repository;
    } else if (!this.options.name) {
      repository = await prompt('Git repository URL (optional): ');
    }

    try {
      this.comment('Creating project...');
      const result = await client.createProject(name.trim(), repository.trim() || undefined);

      ProjectConfig.save({
        project: result.project.slug,
        api: credentials.api,
      });

      this.newLine();
      this.info(`Project "${result.project.name}" created (slug: ${result.project.slug})`);
      this.comment('symphony.json written to project root.');
      this.newLine();
      this.comment('Next steps:');
      this.comment('  orchestr deploy:server add --host=<ip> --name=<name>');
      this.comment('  orchestr deploy');
    } catch (error: any) {
      if (error.status === 409) {
        this.error(`A project with that name already exists.`);
      } else {
        this.error(`Failed to create project: ${error.message}`);
      }
      process.exit(1);
    }
  }
}
