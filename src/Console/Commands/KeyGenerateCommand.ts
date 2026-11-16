/**
 * KeyGenerateCommand
 *
 * Generate a fresh AES-256-GCM application key and write it as `APP_KEY`
 * into the application's environment file. Mirrors Laravel's
 * `php artisan key:generate`.
 *
 * Reuse over duplication: the key format comes from Support/AppKey, the
 * in-place file edit from DotenvWriter (other values, comments, and layout
 * survive untouched), and replacing an existing key goes through the same
 * `confirmToProceed` gate as every destructive command.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import { Command, CommandOptions } from '@/Console/Command';
import { Application } from '@/Foundation/Application';
import { DotenvWriter } from '@/Foundation/Env/DotenvWriter';
import { Env } from '@/Foundation/Env/Env';
import { generateAppKey } from '@/Support/AppKey';

export class KeyGenerateCommand extends Command {
  signature =
    'key:generate {--show : Display the key instead of modifying files} {--force : Overwrite an existing APP_KEY without confirmation}';
  description = 'Set the application key';

  constructor(protected app: Application) {
    super();
  }

  async handle(_args: string[] = [], options: CommandOptions = {}): Promise<void> {
    const key = generateAppKey();

    if (options.show === true || options.show === 'true') {
      this.line(key);
      return;
    }

    const path = `${this.app.getBasePath()}/${this.app.environmentFile()}`;
    const contents = existsSync(path) ? readFileSync(path, 'utf-8') : '';
    const fromEnv = Env.get('APP_KEY');
    const current = DotenvWriter.get(contents, 'APP_KEY') ?? (typeof fromEnv === 'string' ? fromEnv : null);

    if (current !== null && current !== '') {
      // Replacing a working key invalidates encrypted payloads and signed
      // URLs, so it is destructive: confirm interactively, --force elsewhere.
      if (!(await this.confirmToProceed(options, 'The application key is already set. Replace it?'))) {
        this.comment('Key generation cancelled.');
        return;
      }
    }

    writeFileSync(path, DotenvWriter.set(contents, 'APP_KEY', key), 'utf-8');

    // Make the new key live in this process too: the environment for env()
    // consumers and the config repository for config('app.key') readers.
    Env.set('APP_KEY', key);

    if (this.app.bound('config')) {
      try {
        this.app.make<ConfigClass>('config').set('app.key', key);
      } catch {
        // A config repository that refuses the write is not worth failing
        // the file update over; the next boot reads the value from .env.
      }
    }

    this.success('Application key set successfully.');
    this.newLine();
    this.comment(`Set as APP_KEY in: ${path}`);
    this.newLine();
    this.line(key);
  }
}
