/**
 * DeployEnvCommand
 *
 * Get and set environment variables for the current project via the Symphony API.
 * Signature: deploy:env [action]
 * Actions:   list (default), set, unset, push (from local .env file)
 * Options:   --key=<key> --value=<value> --file=<path>
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Command, CommandOptions } from '@/Console/Command';
import { CredentialStore } from '@/Deploy/CredentialStore';
import { ProjectConfig } from '@/Deploy/ProjectConfig';
import { prompt } from '@/Deploy/prompt';
import { SymphonyClient } from '@/Deploy/SymphonyClient';

export class DeployEnvCommand extends Command {
  signature = 'deploy:env [action]';
  description = 'Manage environment variables for the current project (list, set, unset, push)';

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const action = args[0] ?? 'list';

    if (!['list', 'set', 'unset', 'push'].includes(action)) {
      this.error('Usage: orchestr deploy:env [list|set|unset|push]');
      process.exit(1);
    }

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

    switch (action) {
      case 'list':
        await this.list(client, config.project);
        break;
      case 'set':
        await this.set(client, config.project, options);
        break;
      case 'unset':
        await this.unset(client, config.project, options);
        break;
      case 'push':
        await this.push(client, config.project, options);
        break;
    }
  }

  private async list(client: SymphonyClient, slug: string): Promise<void> {
    try {
      const result = await client.getEnvVars(slug);

      if (result.variables.length === 0) {
        this.comment('No environment variables set.');
        return;
      }

      this.info(`Environment variables for: ${slug}`);
      this.newLine();

      result.variables.forEach(({ key, value }) => {
        // Mask values longer than 4 chars
        const masked = value.length > 4 ? value.slice(0, 4) + '*'.repeat(Math.min(value.length - 4, 20)) : '****';
        this.line(`  ${key}=${masked}`);
      });
    } catch (error: any) {
      this.error(`Failed to fetch env vars: ${error.message}`);
      process.exit(1);
    }
  }

  private async set(client: SymphonyClient, slug: string, options: CommandOptions): Promise<void> {
    const key: string = options.key ?? (await prompt('Variable name: '));
    const value: string = options.value ?? (await prompt('Value: ', true));

    if (!key.trim()) {
      this.error('Variable name is required.');
      process.exit(1);
    }

    try {
      // Fetch existing vars, merge in the new one
      const existing = await client.getEnvVars(slug);
      const updated = existing.variables.filter((v) => v.key !== key.trim());
      updated.push({ key: key.trim(), value });

      await client.putEnvVars(slug, updated);
      this.info(`Set ${key.trim()}`);
    } catch (error: any) {
      this.error(`Failed to set env var: ${error.message}`);
      process.exit(1);
    }
  }

  private async unset(client: SymphonyClient, slug: string, options: CommandOptions): Promise<void> {
    const key: string = options.key ?? (await prompt('Variable name to remove: '));

    if (!key.trim()) {
      this.error('Variable name is required.');
      process.exit(1);
    }

    try {
      const existing = await client.getEnvVars(slug);
      const updated = existing.variables.filter((v) => v.key !== key.trim());

      if (updated.length === existing.variables.length) {
        this.warn(`Variable "${key.trim()}" not found.`);
        return;
      }

      await client.putEnvVars(slug, updated);
      this.info(`Unset ${key.trim()}`);
    } catch (error: any) {
      this.error(`Failed to unset env var: ${error.message}`);
      process.exit(1);
    }
  }

  private async push(client: SymphonyClient, slug: string, options: CommandOptions): Promise<void> {
    const filePath: string = options.file ?? join(process.cwd(), '.env');

    if (!existsSync(filePath)) {
      this.error(`.env file not found at: ${filePath}`);
      process.exit(1);
    }

    const variables = this.parseEnvFile(filePath);

    if (variables.length === 0) {
      this.warn('No variables found in .env file.');
      return;
    }

    try {
      await client.putEnvVars(slug, variables);
      this.info(`Pushed ${variables.length} variable(s) from ${filePath}`);
    } catch (error: any) {
      this.error(`Failed to push env vars: ${error.message}`);
      process.exit(1);
    }
  }

  private parseEnvFile(filePath: string): Array<{ key: string; value: string }> {
    const content = readFileSync(filePath, 'utf-8');
    const variables: Array<{ key: string; value: string }> = [];

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (key) {
        variables.push({ key, value });
      }
    }

    return variables;
  }
}
