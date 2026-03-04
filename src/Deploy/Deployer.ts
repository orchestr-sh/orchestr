/**
 * Deployer
 *
 * SSH deployment pipeline — upload tarball, extract, npm ci,
 * symlink shared resources, atomic symlink swap, PM2 reload.
 */

import { execSync } from 'child_process';
import { SSHConnection } from './SSHConnection';
import { SymphonyClient } from './SymphonyClient';

export interface ServerConfig {
  id: number;
  name: string;
  host: string;
  port: number;
  ssh_user: string;
  deploy_path: string;
}

export interface DeployOptions {
  projectSlug: string;
  tarPath: string;
  timestamp: string;
  deploymentUuid: string;
  keyPath?: string;
  migrate?: boolean;
}

export class Deployer {
  constructor(private readonly client: SymphonyClient) {}

  /**
   * Deploy to a single server. Returns log output.
   */
  async deployToServer(server: ServerConfig, options: DeployOptions): Promise<string> {
    const { tarPath, timestamp, deploymentUuid, projectSlug, keyPath, migrate } = options;
    const ssh = new SSHConnection({
      host: server.host,
      user: server.ssh_user,
      port: server.port,
      keyPath,
    });

    const deployPath = server.deploy_path;
    const releasePath = `${deployPath}/releases/${timestamp}`;
    const currentPath = `${deployPath}/current`;
    const sharedEnvPath = `${deployPath}/shared/.env`;
    const sharedStoragePath = `${deployPath}/shared/storage`;
    const remoteTar = `${releasePath}/deploy.tar.gz`;

    const log: string[] = [];
    const run = (cmd: string, label?: string) => {
      if (label) log.push(`→ ${label}`);
      const out = ssh.exec(cmd, { silent: true });
      if (out.trim()) log.push(out.trim());
    };

    try {
      // 1. Create release directory
      run(`mkdir -p "${releasePath}"`, 'Creating release directory');

      // 2. Upload tarball
      log.push('→ Uploading build artifact');
      ssh.upload(tarPath, remoteTar);

      // 3. Extract
      run(`tar -xzf "${remoteTar}" -C "${releasePath}" && rm "${remoteTar}"`, 'Extracting');

      // 4. Install production dependencies
      run(`cd "${releasePath}" && npm ci --omit=dev 2>&1`, 'Installing dependencies');

      // 5. Link shared .env (if exists)
      run(`[ -f "${sharedEnvPath}" ] && ln -sf "${sharedEnvPath}" "${releasePath}/.env" || true`, 'Linking .env');

      // 6. Link shared storage (if exists)
      run(
        `[ -d "${sharedStoragePath}" ] && ln -sf "${sharedStoragePath}" "${releasePath}/storage" || true`,
        'Linking storage'
      );

      // 7. Run migrations if requested
      if (migrate) {
        run(`cd "${releasePath}" && npx orchestr migrate 2>&1`, 'Running migrations');
      }

      // 8. Atomic symlink swap
      run(`ln -sfn "${releasePath}" "${currentPath}"`, 'Activating release');

      // 9. Reload PM2 (or start if first deploy)
      // Detect ecosystem config — prefer .cjs (ESM projects), fall back to .js
      run(
        `cd "${currentPath}" && ECOSYSTEM=$([ -f ecosystem.config.cjs ] && echo ecosystem.config.cjs || echo ecosystem.config.js) && (pm2 reload "$ECOSYSTEM" --update-env 2>&1 || pm2 start "$ECOSYSTEM" 2>&1)`,
        'Reloading PM2'
      );

      // 10. Clean old releases (keep last 5)
      run(
        `ls -dt "${deployPath}/releases"/*/ 2>/dev/null | tail -n +6 | xargs rm -rf 2>/dev/null || true`,
        'Cleaning old releases'
      );

      // Update deployment status to active
      await this.client.updateDeployment(projectSlug, deploymentUuid, {
        status: 'active',
        log: log.join('\n'),
      });

      return log.join('\n');
    } catch (error) {
      const errMsg = (error as Error).message;
      log.push(`✗ Error: ${errMsg}`);

      // Update deployment status to failed
      await this.client
        .updateDeployment(projectSlug, deploymentUuid, {
          status: 'failed',
          log: log.join('\n'),
        })
        .catch(() => {});

      throw new Error(log.join('\n'));
    }
  }
}
