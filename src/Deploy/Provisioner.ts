/**
 * Provisioner
 *
 * Provisions a fresh Ubuntu server for Orchestr deployments via SSH.
 *
 * Steps:
 * 1. Install Node.js 22 (NodeSource)
 * 2. Install PM2 globally
 * 3. Install + configure Nginx as reverse proxy (port 3000)
 * 4. Certbot SSL (if domain provided)
 * 5. Create orchestr user + directory structure
 * 6. Configure UFW firewall (allow 22, 80, 443)
 */

import { SSHConnection } from './SSHConnection';

export interface ProvisionOptions {
  host: string;
  port?: number;
  rootUser?: string;
  keyPath?: string;
  domain?: string;
  email?: string; // for Certbot
  deployPath?: string;
  projectName?: string;
}

export interface ProvisionStep {
  name: string;
  command: string;
}

export class Provisioner {
  private readonly ssh: SSHConnection;
  private readonly domain?: string;
  private readonly certEmail?: string;
  private readonly deployPath: string;
  private readonly projectName: string;

  constructor(private readonly options: ProvisionOptions) {
    this.ssh = new SSHConnection({
      host: options.host,
      user: options.rootUser ?? 'root',
      port: options.port ?? 22,
      keyPath: options.keyPath,
    });
    this.domain = options.domain;
    this.certEmail = options.email;
    this.deployPath = options.deployPath ?? '/home/orchestr';
    this.projectName = options.projectName ?? 'app';
  }

  /**
   * Run the full provisioning pipeline.
   * Calls onStep for progress reporting.
   */
  async provision(onStep?: (step: string) => void): Promise<void> {
    const run = (label: string, cmd: string) => {
      onStep?.(label);
      this.ssh.exec(cmd, { silent: true });
    };

    // 1. Update apt
    run('Updating package list', 'apt-get update -qq');

    // 2. Install Node.js 22 via NodeSource
    run(
      'Installing Node.js 22',
      [
        'apt-get install -y -qq curl',
        'curl -fsSL https://deb.nodesource.com/setup_22.x | bash -',
        'apt-get install -y -qq nodejs',
      ].join(' && ')
    );

    // 3. Install PM2 globally
    run('Installing PM2', 'npm install -g pm2 --quiet && pm2 startup systemd -u orchestr --hp /home/orchestr || true');

    // 4. Install Nginx
    run('Installing Nginx', 'apt-get install -y -qq nginx');

    // 5. Configure Nginx reverse proxy
    const nginxConf = this.buildNginxConfig();
    run(
      'Configuring Nginx',
      [
        `cat > /etc/nginx/sites-available/${this.projectName} << 'NGINX'\n${nginxConf}\nNGINX`,
        `ln -sf /etc/nginx/sites-available/${this.projectName} /etc/nginx/sites-enabled/${this.projectName}`,
        'rm -f /etc/nginx/sites-enabled/default',
        'nginx -t && systemctl reload nginx',
      ].join(' && ')
    );

    // 6. SSL via Certbot (if domain provided)
    if (this.domain && this.certEmail) {
      run('Installing Certbot', 'apt-get install -y -qq certbot python3-certbot-nginx');
      run(
        `Obtaining SSL certificate for ${this.domain}`,
        `certbot --nginx -d ${this.domain} --non-interactive --agree-tos --email ${this.certEmail} --redirect`
      );
    }

    // 7. Create orchestr user
    run(
      'Creating orchestr user',
      [
        'id -u orchestr &>/dev/null || useradd -m -s /bin/bash orchestr',
        `mkdir -p ${this.deployPath}/${this.projectName}/releases`,
        `mkdir -p ${this.deployPath}/${this.projectName}/shared`,
        `touch ${this.deployPath}/${this.projectName}/shared/.env`,
        `chown -R orchestr:orchestr ${this.deployPath}`,
      ].join(' && ')
    );

    // 8. Configure UFW firewall
    run(
      'Configuring UFW firewall',
      [
        'apt-get install -y -qq ufw',
        'ufw --force reset',
        'ufw allow 22/tcp',
        'ufw allow 80/tcp',
        'ufw allow 443/tcp',
        'ufw --force enable',
      ].join(' && ')
    );

    // 9. Enable Nginx on boot
    run('Enabling services on boot', 'systemctl enable nginx');
  }

  /**
   * Check that the server is reachable.
   */
  testConnection(): boolean {
    return this.ssh.test();
  }

  private buildNginxConfig(): string {
    const serverName = this.domain ?? '_';
    return `server {
    listen 80;
    server_name ${serverName};

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}`;
  }
}
