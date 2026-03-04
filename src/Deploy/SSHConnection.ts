/**
 * SSHConnection
 *
 * Wrapper around system ssh/scp commands via child_process.
 * Zero npm dependencies — uses Node.js built-ins only.
 */

import { execSync, ExecSyncOptions } from 'child_process';

export interface SSHConfig {
  host: string;
  user: string;
  port?: number;
  keyPath?: string;
}

export class SSHConnection {
  private readonly host: string;
  private readonly user: string;
  private readonly port: number;
  private readonly keyPath?: string;

  constructor(config: SSHConfig) {
    this.host = config.host;
    this.user = config.user;
    this.port = config.port ?? 22;
    this.keyPath = config.keyPath;
  }

  private get sshArgs(): string {
    const args: string[] = [
      '-o StrictHostKeyChecking=accept-new',
      '-o UserKnownHostsFile=/dev/null',
      '-o BatchMode=yes',
      `-p ${this.port}`,
    ];

    if (this.keyPath) {
      args.push(`-i "${this.keyPath}"`);
    }

    return args.join(' ');
  }

  private get target(): string {
    return `${this.user}@${this.host}`;
  }

  /**
   * Run a command on the remote server.
   * Returns stdout as a string.
   */
  exec(command: string, opts: { silent?: boolean } = {}): string {
    // Use single quotes so $VAR expansion happens on the remote shell, not locally.
    // Escape any literal single quotes in the command via the '"'"' trick.
    const escaped = command.replace(/'/g, `'"'"'`);
    const cmd = `ssh ${this.sshArgs} ${this.target} '${escaped}'`;
    const options: ExecSyncOptions = {
      stdio: opts.silent ? 'pipe' : 'inherit',
      encoding: 'utf-8',
    };

    return (execSync(cmd, options) as string) ?? '';
  }

  /**
   * Upload a local file to the remote server via scp.
   */
  upload(localPath: string, remotePath: string): void {
    const scpArgs: string[] = [
      '-o StrictHostKeyChecking=accept-new',
      '-o UserKnownHostsFile=/dev/null',
      `-P ${this.port}`,
    ];

    if (this.keyPath) {
      scpArgs.push(`-i "${this.keyPath}"`);
    }

    const cmd = `scp ${scpArgs.join(' ')} "${localPath}" ${this.target}:"${remotePath}"`;
    execSync(cmd, { stdio: 'inherit' });
  }

  /**
   * Test that the SSH connection is reachable.
   * Returns true if successful, false otherwise.
   */
  test(): boolean {
    try {
      this.exec('echo ok', { silent: true });
      return true;
    } catch {
      return false;
    }
  }
}
