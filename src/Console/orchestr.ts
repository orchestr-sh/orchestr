#!/usr/bin/env node
/**
 * Orchestr CLI
 *
 * Command-line interface for Orchestr
 */

import { Application } from '@/Foundation/Application';
import { coreCommands, deployCommands } from './Commands';
import { ConsoleKernel } from './ConsoleKernel';

// Create application instance
const app = new Application();

// Create console kernel
class OrchestrKernel extends ConsoleKernel {
  protected registerCommands(): void {
    this.registerMany([...coreCommands(this.app), ...deployCommands()]);
  }
}

// Run the CLI
const kernel = new OrchestrKernel(app);

// Application commands live in app/Console/Commands; discover and register
// them after the framework manifest so apps can override built-ins by name.
kernel
  .discoverCommands()
  .then(() => kernel.run())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
