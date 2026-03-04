/**
 * CredentialStore
 *
 * Manages ~/.orchestr/credentials (JSON, 0600 permissions)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface Credentials {
  token: string;
  email: string;
  api: string;
}

export class CredentialStore {
  private static readonly DIR = join(homedir(), '.orchestr');
  private static readonly FILE = join(CredentialStore.DIR, 'credentials');

  /**
   * Load credentials from disk. Returns null if not found.
   */
  static load(): Credentials | null {
    if (!existsSync(this.FILE)) {
      return null;
    }

    try {
      const raw = readFileSync(this.FILE, 'utf-8');
      return JSON.parse(raw) as Credentials;
    } catch {
      return null;
    }
  }

  /**
   * Save credentials to disk with 0600 permissions.
   */
  static save(credentials: Credentials): void {
    if (!existsSync(this.DIR)) {
      mkdirSync(this.DIR, { recursive: true, mode: 0o700 });
    }

    writeFileSync(this.FILE, JSON.stringify(credentials, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }

  /**
   * Remove credentials from disk.
   */
  static clear(): void {
    if (existsSync(this.FILE)) {
      const { unlinkSync } = require('fs');
      unlinkSync(this.FILE);
    }
  }

  /**
   * Check if credentials are stored.
   */
  static exists(): boolean {
    return existsSync(this.FILE);
  }
}
