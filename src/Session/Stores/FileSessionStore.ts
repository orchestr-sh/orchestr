/**
 * FileSessionStore
 *
 * Persists each session as a JSON file named `sess_<id>` below the
 * configured path, mirroring Laravel's FileSessionHandler. Writes go to a
 * temporary file first and are renamed into place so a concurrent reader
 * never sees a half-written payload, and payloads carry an expiry stamped
 * from the configured lifetime.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { Str } from '@/Support/Str';
import { BaseSessionStore } from './BaseSessionStore';

export class FileSessionStore extends BaseSessionStore {
  protected read(): Record<string, any> | null {
    const file = this.fileName(this.id);

    let payload: { expires: number; data: Record<string, any> };

    try {
      payload = JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
      return null;
    }

    if (!payload || typeof payload !== 'object' || typeof payload.data !== 'object' || payload.data === null) {
      return null;
    }

    if (payload.expires !== 0 && payload.expires <= this.currentTime()) {
      this.destroy(this.id);
      return null;
    }

    return payload.data;
  }

  protected write(attributes: Record<string, any>): void {
    const file = this.fileName(this.id);

    mkdirSync(this.storagePath(), { recursive: true });

    const content = JSON.stringify({
      expires: this.expiresAt(),
      data: attributes,
    });

    // Atomic write: fill a uniquely named temp file in the same directory
    // and rename it over the target, which is atomic on POSIX filesystems
    const temp = `${file}.${process.pid}.${Str.random(8)}.tmp`;

    writeFileSync(temp, content, 'utf-8');
    renameSync(temp, file);

    this.maybeCollectGarbage();
  }

  protected destroy(id: string): void {
    try {
      unlinkSync(this.fileName(id));
    } catch {
      // Nothing stored for that ID - already gone
    }
  }

  /**
   * Collect garbage on a configurable slice of writes so long-lived
   * processes prune themselves without a scheduler
   */
  protected maybeCollectGarbage(): void {
    const probability = Number(this.config.gc_probability ?? 0.02);

    if (probability > 0 && Math.random() < probability) {
      this.gc();
    }
  }

  /**
   * Delete session files whose last write predates the configured
   * lifetime; returns the number of files removed
   * Laravel: FileSessionHandler::gc()
   */
  gc(): number {
    const dir = this.storagePath();

    if (!existsSync(dir)) {
      return 0;
    }

    const cutoff = this.currentTime() - this.lifetimeSeconds();
    let removed = 0;

    for (const entry of this.readDirectory(dir)) {
      const file = join(dir, entry);

      try {
        if (statSync(file).mtimeMs / 1000 < cutoff) {
          rmSync(file, { force: true });
          removed++;
        }
      } catch {
        // File raced away between readdir and stat - nothing to collect
      }
    }

    return removed;
  }

  protected storagePath(): string {
    return this.config.path || 'storage/framework/sessions';
  }

  protected fileName(id: string): string {
    return join(this.storagePath(), `sess_${id}`);
  }

  protected lifetimeSeconds(): number {
    return Number(this.config.lifetime ?? 120) * 60;
  }

  protected expiresAt(): number {
    return this.currentTime() + this.lifetimeSeconds();
  }

  protected currentTime(): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Directory listing that treats a vanished directory as empty
   */
  private readDirectory(dir: string): string[] {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  }
}
