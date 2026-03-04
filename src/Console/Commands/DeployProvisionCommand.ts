/**
 * DeployProvisionCommand
 *
 * Provision a fresh Ubuntu server for Orchestr deployments.
 * Signature: deploy:provision
 * Options:   --host=<ip> --user=<root-user> --port=<port> --key=<path>
 *            --domain=<domain> --email=<email> --name=<project-name>
 */

import { Command, CommandOptions } from '@/Console/Command';
import { Provisioner } from '@/Deploy/Provisioner';
import { prompt } from '@/Deploy/prompt';

export class DeployProvisionCommand extends Command {
  signature = 'deploy:provision';
  description = 'Provision a fresh Ubuntu server for Orchestr deployments';

  async handle(_args: string[], options: CommandOptions): Promise<void> {
    this.info('Symphony — Server Provisioner');
    this.newLine();
    this.warn('This command will install software on a remote server.');
    this.warn('Ensure you have root/sudo SSH access before continuing.');
    this.newLine();

    // Gather required inputs
    const host: string = options.host ?? (await prompt('Server IP or hostname: '));
    if (!host.trim()) {
      this.error('Host is required.');
      process.exit(1);
    }

    const rootUserRaw = options.user ?? (await prompt('SSH user [root]: '));
    const rootUser: string = rootUserRaw || 'root';
    const portRaw = options.port ?? (await prompt('SSH port [22]: '));
    const portStr: string = portRaw || '22';
    const port = parseInt(portStr, 10) || 22;
    const keyPath: string | undefined = options.key ?? undefined;
    const domainRaw = options.domain ?? (await prompt('Domain name (optional, for SSL): '));
    const domain: string | undefined = domainRaw || undefined;
    const certEmailRaw = domain ? (options.email ?? (await prompt('Email for SSL certificate: '))) : undefined;
    const certEmail: string | undefined = certEmailRaw || undefined;
    const projectNameRaw = options.name ?? (await prompt('Project name [app]: '));
    const projectName: string = projectNameRaw || 'app';

    const provisioner = new Provisioner({
      host: host.trim(),
      port,
      rootUser: rootUser.trim(),
      keyPath: keyPath?.trim(),
      domain: domain?.trim(),
      email: certEmail?.trim(),
      projectName: projectName.trim(),
    });

    // Test connectivity first
    this.comment('Testing SSH connection...');
    if (!provisioner.testConnection()) {
      this.error('Cannot connect to server. Check host, port, and SSH key.');
      process.exit(1);
    }
    this.info('Connection successful.');
    this.newLine();

    const confirm = await prompt('Proceed with provisioning? (y/N): ');
    if (confirm.toLowerCase() !== 'y') {
      this.comment('Provisioning cancelled.');
      return;
    }

    this.newLine();
    this.info('Provisioning server...');
    this.newLine();

    try {
      await provisioner.provision((step) => {
        this.comment(`  ▶ ${step}`);
      });

      this.newLine();
      this.info('Server provisioned successfully.');
      this.newLine();
      this.comment('What was installed:');
      this.comment('  ✓ Node.js 22');
      this.comment('  ✓ PM2 (process manager)');
      this.comment('  ✓ Nginx (reverse proxy → port 3000)');
      if (domain) {
        this.comment(`  ✓ SSL certificate for ${domain}`);
      }
      this.comment('  ✓ orchestr user + directory structure');
      this.comment('  ✓ UFW firewall (22, 80, 443)');
      this.newLine();
      this.comment('Next steps:');
      this.comment(`  1. Add an SSH key for the orchestr user`);
      this.comment(
        `  2. orchestr deploy:server add --host=${host.trim()} --user=orchestr --name=${projectName.trim()}`
      );
      this.comment(`  3. orchestr deploy`);
    } catch (error: any) {
      this.error(`Provisioning failed: ${error.message}`);
      process.exit(1);
    }
  }
}
