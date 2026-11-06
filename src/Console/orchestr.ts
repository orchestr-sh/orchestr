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
kernel.run().catch((error) => {
  console.error(error);
  process.exit(1);
});
