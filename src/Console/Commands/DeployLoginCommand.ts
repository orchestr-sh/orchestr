/**
 * DeployLoginCommand
 *
 * Authenticate with the Symphony API and store credentials locally.
 * Signature: deploy:login
 * Options:   --email=<email> --password=<password> --api=<url>
 */

import { Command, CommandOptions } from '@/Console/Command';
import { CredentialStore } from '@/Deploy/CredentialStore';
import { SymphonyClient } from '@/Deploy/SymphonyClient';
import { prompt } from '@/Deploy/prompt';

const DEFAULT_API = 'https://symphony.orchestr.sh';

export class DeployLoginCommand extends Command {
  signature = 'deploy:login';
  description = 'Authenticate with the Symphony API and store credentials locally';

  async handle(_args: string[], options: CommandOptions): Promise<void> {
    const api: string = options.api ?? DEFAULT_API;

    this.info('Symphony — Orchestr Deployment');
    this.newLine();

    const email: string = options.email ?? (await prompt('Email: '));
    const password: string = options.password ?? (await prompt('Password: ', true));

    if (!email || !password) {
      this.error('Email and password are required.');
      process.exit(1);
    }

    const client = new SymphonyClient(api);

    try {
      this.comment('Authenticating...');
      const result = await client.login(email.trim(), password);

      CredentialStore.save({
        token: result.token,
        email: result.user.email,
        api,
      });

      this.newLine();
      this.info(`Authenticated as ${result.user.email}`);
      this.comment(`Credentials saved to ~/.orchestr/credentials`);
    } catch (error: any) {
      if (error.status === 401) {
        this.error('Invalid credentials. Please check your email and password.');
      } else {
        this.error(`Login failed: ${error.message}`);
      }
      process.exit(1);
    }
  }
}
