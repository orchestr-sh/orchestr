#!/usr/bin/env node
/**
 * Orchestr CLI
 *
 * Command-line interface for Orchestr
 */

import { Application } from '../Foundation/Application';
import { ConsoleKernel } from './ConsoleKernel';
import { MigrateCommand } from './Commands/MigrateCommand';
import { MigrateRollbackCommand } from './Commands/MigrateRollbackCommand';
import { MigrateResetCommand } from './Commands/MigrateResetCommand';
import { MigrateRefreshCommand } from './Commands/MigrateRefreshCommand';
import { MigrateFreshCommand } from './Commands/MigrateFreshCommand';
import { MigrateStatusCommand } from './Commands/MigrateStatusCommand';
import { MakeMigrationCommand } from './Commands/MakeMigrationCommand';
import { SeedCommand } from './Commands/SeedCommand';
import { MakeSeederCommand } from './Commands/MakeSeederCommand';
import { MakeEventCommand } from './Commands/MakeEventCommand';
import { MakeListenerCommand } from './Commands/MakeListenerCommand';
import { EventListCommand } from './Commands/EventListCommand';
import { EventCacheCommand } from './Commands/EventCacheCommand';
import { EventClearCommand } from './Commands/EventClearCommand';

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
      new EventListCommand(this.app),
      new EventCacheCommand(this.app),
      new EventClearCommand(this.app),
    ]);
  }
}

// Run the CLI
const kernel = new OrchestrKernel(app);
kernel.run().catch((error) => {
  console.error(error);
  process.exit(1);
});
