/**
 * DeployCommand
 *
 * The main deployment command. Runs the full deployment pipeline.
 * Signature: deploy
 * Options:   --server=<name> --migrate --no-build
 */

import { execSync } from 'child_process';
import { unlinkSync } from 'fs';
import { Command, CommandOptions } from '@/Console/Command';
import { CredentialStore } from '@/Deploy/CredentialStore';
import { ProjectConfig } from '@/Deploy/ProjectConfig';
import { SymphonyClient } from '@/Deploy/SymphonyClient';
import { TarBuilder } from '@/Deploy/TarBuilder';
import { Deployer } from '@/Deploy/Deployer';

export class DeployCommand extends Command {
  signature = 'deploy';
  description = 'Deploy the current project to configured servers';

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

    // 1. Build (unless --no-build)
    if (!options['no-build']) {
      this.info('Building project...');
      try {
        execSync('npm run build', { stdio: 'inherit' });
      } catch {
        this.error('Build failed.');
        process.exit(1);
      }
    }

    // 2. Create tarball
    this.info('Creating deployment artifact...');
    let tarResult: { path: string; timestamp: string };
    try {
      tarResult = TarBuilder.build();
      this.comment(`  Archive: ${tarResult.path}`);
    } catch (error: any) {
      this.error(`Failed to create tarball: ${error.message}`);
      process.exit(1);
    }

    // 3. Fetch server list
    let servers: Awaited<ReturnType<typeof client.listServers>>['servers'];
    try {
      const result = await client.listServers(config.project);
      servers = result.servers;
    } catch (error: any) {
      this.error(`Failed to fetch servers: ${error.message}`);
      process.exit(1);
    }

    if (servers.length === 0) {
      this.error('No servers configured. Run `orchestr deploy:server add` first.');
      process.exit(1);
    }

    // Filter by --server if provided
    const serverFilter: string | undefined = options.server;
    const targetServers = serverFilter ? servers.filter((s) => s.name === serverFilter) : servers;

    if (targetServers.length === 0) {
      this.error(`No server named "${serverFilter}" found.`);
      process.exit(1);
    }

    // Get current git info
    const commitHash = this.getGitHash();
    const commitMessage = this.getGitMessage();

    // Deploy to each server
    const deployer = new Deployer(client);
    let anyFailed = false;

    for (const server of targetServers) {
      this.newLine();
      this.info(`Deploying to ${server.name} (${server.host})...`);

      // 4. Create deployment record
      let deploymentUuid: string;
      try {
        const dep = await client.createDeployment(config.project, {
          server_id: server.id,
          commit_hash: commitHash,
          commit_message: commitMessage,
        });
        deploymentUuid = dep.deployment.uuid;
      } catch (error: any) {
        this.error(`Failed to create deployment record: ${error.message}`);
        anyFailed = true;
        continue;
      }

      // 5. SSH deploy
      try {
        await deployer.deployToServer(server, {
          projectSlug: config.project,
          tarPath: tarResult.path,
          timestamp: tarResult.timestamp,
          deploymentUuid,
          keyPath: options.key,
          migrate: !!options.migrate,
        });

        this.info(`✓ ${server.name} deployed successfully`);
      } catch (error: any) {
        this.error(`✗ ${server.name} deployment failed`);
        if (error?.message) {
          this.error(error.message);
        }
        anyFailed = true;
      }
    }

    // Cleanup tarball
    try {
      unlinkSync(tarResult.path);
    } catch {}

    this.newLine();
    if (anyFailed) {
      this.error('Deployment completed with errors.');
      process.exit(1);
    } else {
      this.info('Deployment complete.');
    }
  }

  private getGitHash(): string | undefined {
    try {
      return execSync('git rev-parse --short HEAD', { stdio: 'pipe', encoding: 'utf-8' }).trim();
    } catch {
      return undefined;
    }
  }

  private getGitMessage(): string | undefined {
    try {
      return execSync('git log -1 --pretty=%s', { stdio: 'pipe', encoding: 'utf-8' }).trim();
    } catch {
      return undefined;
    }
  }
}
