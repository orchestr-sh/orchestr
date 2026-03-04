/**
 * ProjectConfig
 *
 * Manages symphony.json in the project root
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface SymphonyConfig {
  project: string;
  api: string;
}

export class ProjectConfig {
  private static readonly FILENAME = 'symphony.json';

  private static getPath(cwd: string = process.cwd()): string {
    return join(cwd, this.FILENAME);
  }

  /**
   * Load symphony.json from the current working directory. Returns null if not found.
   */
  static load(cwd: string = process.cwd()): SymphonyConfig | null {
    const path = this.getPath(cwd);

    if (!existsSync(path)) {
      return null;
    }

    try {
      const raw = readFileSync(path, 'utf-8');
      return JSON.parse(raw) as SymphonyConfig;
    } catch {
      return null;
    }
  }

  /**
   * Save symphony.json to the current working directory.
   */
  static save(config: SymphonyConfig, cwd: string = process.cwd()): void {
    const path = this.getPath(cwd);
    writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  }

  /**
   * Check if symphony.json exists in the current working directory.
   */
  static exists(cwd: string = process.cwd()): boolean {
    return existsSync(this.getPath(cwd));
  }
}
