/**
 * Command Manifest
 *
 * Single source of truth for the built-in console commands. The CLI kernel
 * (src/Console/orchestr.ts) and the regression tests both consume this
 * manifest, so a command only needs to be listed here once.
 *
 * `coreCommands(app)` returns every application-aware command.
 * `deployCommands()` is kept separate so embedders can omit the deploy tooling.
 */

import type { Application } from '@/Foundation/Application';
import type { Command } from '../Command';
import { CacheClearCommand } from './CacheClearCommand';
import { CacheForgetCommand } from './CacheForgetCommand';
import { CacheTableCommand } from './CacheTableCommand';
import { DeployCommand } from './DeployCommand';
import { DeployEnvCommand } from './DeployEnvCommand';
import { DeployInitCommand } from './DeployInitCommand';
import { DeployLoginCommand } from './DeployLoginCommand';
import { DeployProvisionCommand } from './DeployProvisionCommand';
import { DeployRollbackCommand } from './DeployRollbackCommand';
import { DeployServerCommand } from './DeployServerCommand';
import { DeployStatusCommand } from './DeployStatusCommand';
import { EventCacheCommand } from './EventCacheCommand';
import { EventClearCommand } from './EventClearCommand';
import { EventListCommand } from './EventListCommand';
import { MakeControllerCommand } from './MakeControllerCommand';
import { MakeEventCommand } from './MakeEventCommand';
import { MakeJobCommand } from './MakeJobCommand';
import { MakeListenerCommand } from './MakeListenerCommand';
import { MakeMigrationCommand } from './MakeMigrationCommand';
import { MakeSeederCommand } from './MakeSeederCommand';
import { MakeViewCommand } from './MakeViewCommand';
import { MigrateCommand } from './MigrateCommand';
import { MigrateFreshCommand } from './MigrateFreshCommand';
import { MigrateInstallCommand } from './MigrateInstallCommand';
import { MigrateRefreshCommand } from './MigrateRefreshCommand';
import { MigrateResetCommand } from './MigrateResetCommand';
import { MigrateRollbackCommand } from './MigrateRollbackCommand';
import { MigrateStatusCommand } from './MigrateStatusCommand';
import { QueueBatchesTableCommand } from './QueueBatchesTableCommand';
import { QueueClearCommand } from './QueueClearCommand';
import { QueueFailedCommand } from './QueueFailedCommand';
import { QueueFailedTableCommand } from './QueueFailedTableCommand';
import { QueueFlushCommand } from './QueueFlushCommand';
import { QueueForgetCommand } from './QueueForgetCommand';
import { QueueListenCommand } from './QueueListenCommand';
import { QueueMonitorCommand } from './QueueMonitorCommand';
import { QueuePruneBatchesCommand } from './QueuePruneBatchesCommand';
import { QueuePruneFailedCommand } from './QueuePruneFailedCommand';
import { QueueRestartCommand } from './QueueRestartCommand';
import { QueueRetryCommand } from './QueueRetryCommand';
import { QueueTableCommand } from './QueueTableCommand';
import { QueueWorkCommand } from './QueueWorkCommand';
import { SeedCommand } from './SeedCommand';

/**
 * All application commands (migration, seeder, event, queue, cache, view).
 */
export function coreCommands(app: Application): Command[] {
  return [
    // Migration commands
    new MigrateCommand(app),
    new MigrateInstallCommand(app),
    new MigrateRollbackCommand(app),
    new MigrateResetCommand(app),
    new MigrateRefreshCommand(app),
    new MigrateFreshCommand(app),
    new MigrateStatusCommand(app),
    new MakeMigrationCommand(app),
    // Seeder commands
    new SeedCommand(app),
    new MakeSeederCommand(app),
    // Event commands
    new MakeEventCommand(app),
    new MakeListenerCommand(app),
    new MakeControllerCommand(app),
    new EventListCommand(app),
    new EventCacheCommand(app),
    new EventClearCommand(app),
    // Queue commands
    new QueueWorkCommand(app),
    new QueueListenCommand(app),
    new QueueRestartCommand(app),
    new QueueFailedCommand(app),
    new QueueRetryCommand(app),
    new QueueForgetCommand(app),
    new QueueFlushCommand(app),
    new QueueClearCommand(app),
    new QueueMonitorCommand(app),
    new QueueTableCommand(app),
    new QueueFailedTableCommand(app),
    new QueueBatchesTableCommand(app),
    new QueuePruneBatchesCommand(app),
    new QueuePruneFailedCommand(app),
    // Job commands
    new MakeJobCommand(app),
    // Cache commands
    new CacheClearCommand(app),
    new CacheForgetCommand(app),
    new CacheTableCommand(app),
    // View commands
    new MakeViewCommand(app),
  ];
}

/**
 * Deploy commands (standalone; they do not require the application instance).
 */
export function deployCommands(): Command[] {
  return [
    new DeployLoginCommand(),
    new DeployInitCommand(),
    new DeployServerCommand(),
    new DeployCommand(),
    new DeployStatusCommand(),
    new DeployEnvCommand(),
    new DeployRollbackCommand(),
    new DeployProvisionCommand(),
  ];
}
