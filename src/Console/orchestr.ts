#!/usr/bin/env node
/**
 * Orchestr CLI
 *
 * Command-line interface for Orchestr
 */

import { Application } from '@/Foundation/Application';
import { DeployCommand } from './Commands/DeployCommand';
import { DeployEnvCommand } from './Commands/DeployEnvCommand';
import { DeployInitCommand } from './Commands/DeployInitCommand';
import { DeployLoginCommand } from './Commands/DeployLoginCommand';
import { DeployProvisionCommand } from './Commands/DeployProvisionCommand';
import { DeployRollbackCommand } from './Commands/DeployRollbackCommand';
import { DeployServerCommand } from './Commands/DeployServerCommand';
import { DeployStatusCommand } from './Commands/DeployStatusCommand';
import { EventCacheCommand } from './Commands/EventCacheCommand';
import { EventClearCommand } from './Commands/EventClearCommand';
import { EventListCommand } from './Commands/EventListCommand';
import { MakeControllerCommand } from './Commands/MakeControllerCommand';
import { MakeEventCommand } from './Commands/MakeEventCommand';
import { MakeListenerCommand } from './Commands/MakeListenerCommand';
import { MakeMigrationCommand } from './Commands/MakeMigrationCommand';
import { MakeSeederCommand } from './Commands/MakeSeederCommand';
import { MigrateCommand } from './Commands/MigrateCommand';
import { MigrateFreshCommand } from './Commands/MigrateFreshCommand';
import { MigrateRefreshCommand } from './Commands/MigrateRefreshCommand';
import { MigrateResetCommand } from './Commands/MigrateResetCommand';
import { MigrateRollbackCommand } from './Commands/MigrateRollbackCommand';
import { MigrateStatusCommand } from './Commands/MigrateStatusCommand';
import { SeedCommand } from './Commands/SeedCommand';
import { ConsoleKernel } from './ConsoleKernel';

// Create application instance
const app = new Application();

// Create console kernel
class OrchestrKernel extends ConsoleKernel {
  protected registerCommands(): void {
    // Register migration commands
    this.registerMany([
      new MigrateCommand(this.app),
      new MigrateRollbackCommand(this.app),
      new MigrateResetCommand(this.app),
      new MigrateRefreshCommand(this.app),
      new MigrateFreshCommand(this.app),
      new MigrateStatusCommand(this.app),
      new MakeMigrationCommand(this.app),
      new SeedCommand(this.app),
      new MakeSeederCommand(this.app),
      new MakeEventCommand(this.app),
      new MakeListenerCommand(this.app),
      new MakeControllerCommand(this.app),
      new EventListCommand(this.app),
      new EventCacheCommand(this.app),
      new EventClearCommand(this.app),
      // Deploy commands
      new DeployLoginCommand(),
      new DeployInitCommand(),
      new DeployServerCommand(),
      new DeployCommand(),
      new DeployStatusCommand(),
      new DeployEnvCommand(),
      new DeployRollbackCommand(),
      new DeployProvisionCommand(),
    ]);
  }
}

// Run the CLI
const kernel = new OrchestrKernel(app);
kernel.run().catch((error) => {
  console.error(error);
  process.exit(1);
});
