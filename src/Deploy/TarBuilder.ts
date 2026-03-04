/**
 * TarBuilder
 *
 * Creates a deployment tarball containing dist/, package.json,
 * package-lock.json (or bun.lockb), and ecosystem.config.js.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface TarBuildResult {
  path: string;
  timestamp: string;
}

export class TarBuilder {
  /**
   * Build a tarball from the project directory.
   * Returns the path to the tarball and the release timestamp.
   */
  static build(projectDir: string = process.cwd()): TarBuildResult {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:\-T.Z]/g, '')
      .slice(0, 14);
    const tarName = `deploy-${timestamp}.tar.gz`;
    const tarPath = join(tmpdir(), tarName);

    // Collect files/dirs to include
    const includes: string[] = ['dist'];

    const optionals = [
      'package.json',
      'package-lock.json',
      'bun.lockb',
      'yarn.lock',
      'ecosystem.config.js',
      'ecosystem.config.cjs',
      'dist-entry.js',
    ];

    for (const f of optionals) {
      if (existsSync(join(projectDir, f))) {
        includes.push(f);
      }
    }

    if (!existsSync(join(projectDir, 'dist'))) {
      throw new Error('dist/ directory not found. Run npm run build first.');
    }

    const includeList = includes.map((f) => `"${f}"`).join(' ');
    execSync(`tar -czf "${tarPath}" -C "${projectDir}" ${includeList}`, {
      stdio: 'inherit',
    });

    return { path: tarPath, timestamp };
  }
}
