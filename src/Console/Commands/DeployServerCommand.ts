/**
 * DeployServerCommand
 *
 * Manage servers for the current project.
 * Signature: deploy:server <action>
 * Actions:   add, list, remove
 * Options:   --host=<host> --user=<user> --port=<port> --name=<name>
 */

import { Command, CommandOptions } from '@/Console/Command';
import { CredentialStore } from '@/Deploy/CredentialStore';
import { ProjectConfig } from '@/Deploy/ProjectConfig';
import { SymphonyClient } from '@/Deploy/SymphonyClient';
import { prompt } from '@/Deploy/prompt';

export class DeployServerCommand extends Command {
  signature = 'deploy:server <action>';
  description = 'Manage servers for the current project (add, list, remove)';

  async handle(args: string[], options: CommandOptions): Promise<void> {
    const action = args[0];

    if (!action || !['add', 'list', 'remove'].includes(action)) {
      this.error('Usage: orchestr deploy:server <add|list|remove>');
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
      case 'add':
        await this.add(client, config.project, options);
        break;
      case 'list':
        await this.list(client, config.project);
        break;
      case 'remove':
        await this.remove(client, config.project, options);
        break;
    }
  }

  private async add(client: SymphonyClient, slug: string, options: CommandOptions): Promise<void> {
    const name: string = options.name ?? (await prompt('Server name: '));
    const host: string = options.host ?? (await prompt('Host (IP or hostname): '));
    const sshUserRaw = options.user ?? (await prompt('SSH user [orchestr]: '));
    const sshUser: string = sshUserRaw || 'orchestr';
    const portRaw = options.port ?? (await prompt('SSH port [22]: '));
    const portStr: string = portRaw || '22';
    const port = parseInt(portStr, 10) || 22;
    const deployPathRaw = options['deploy-path'] ?? (await prompt('Deploy path [/home/orchestr]: '));
    const deployPath: string = deployPathRaw || '/home/orchestr';

    if (!name.trim() || !host.trim()) {
      this.error('Server name and host are required.');
      process.exit(1);
    }

    try {
      const result = await client.addServer(slug, {
        name: name.trim(),
        host: host.trim(),
        port,
        ssh_user: sshUser.trim(),
        deploy_path: deployPath.trim(),
      });

      this.newLine();
      this.info(`Server "${result.server.name}" added (ID: ${result.server.id})`);
      this.comment(`  Host: ${result.server.host}:${result.server.port}`);
      this.comment(`  User: ${result.server.ssh_user}`);
      this.comment(`  Path: ${result.server.deploy_path}`);
    } catch (error: any) {
      this.error(`Failed to add server: ${error.message}`);
      process.exit(1);
    }
  }

  private async list(client: SymphonyClient, slug: string): Promise<void> {
    try {
      const result = await client.listServers(slug);

      if (result.servers.length === 0) {
        this.comment('No servers configured. Use `orchestr deploy:server add` to add one.');
        return;
      }

      this.info(`Servers for project: ${slug}`);
      this.newLine();

      const rows = result.servers.map((s) => [
        s.id.toString(),
        s.name,
        `${s.host}:${s.port}`,
        s.ssh_user,
        s.deploy_path,
        s.status ?? 'unknown',
        s.last_deployed_at ? new Date(s.last_deployed_at).toLocaleString() : 'never',
      ]);

      this.table(['ID', 'Name', 'Host', 'User', 'Deploy Path', 'Status', 'Last Deployed'], rows);
    } catch (error: any) {
      this.error(`Failed to list servers: ${error.message}`);
      process.exit(1);
    }
  }

  private async remove(client: SymphonyClient, slug: string, options: CommandOptions): Promise<void> {
    const nameOrId: string = options.name ?? options.id ?? (await prompt('Server name or ID: '));

    if (!nameOrId.trim()) {
      this.error('Server name or ID is required.');
      process.exit(1);
    }

    try {
      // Fetch servers to resolve name → id
      const result = await client.listServers(slug);
      const server = result.servers.find((s) => s.name === nameOrId.trim() || s.id.toString() === nameOrId.trim());

      if (!server) {
        this.error(`Server "${nameOrId}" not found.`);
        process.exit(1);
      }

      await client.deleteServer(slug, server.id);
      this.info(`Server "${server.name}" removed.`);
    } catch (error: any) {
      this.error(`Failed to remove server: ${error.message}`);
      process.exit(1);
    }
  }
}
