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
import { ConfigCacheCommand } from './ConfigCacheCommand';
import { ConfigClearCommand } from './ConfigClearCommand';
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
import { MakeCastCommand } from './MakeCastCommand';
import { MakeChannelCommand } from './MakeChannelCommand';
import { MakeClassCommand } from './MakeClassCommand';
import { MakeCollectionCommand } from './MakeCollectionCommand';
import { MakeCommandCommand } from './MakeCommandCommand';
import { MakeControllerCommand } from './MakeControllerCommand';
import { MakeEnumCommand } from './MakeEnumCommand';
import { MakeEventCommand } from './MakeEventCommand';
import { MakeExceptionCommand } from './MakeExceptionCommand';
import { MakeFactoryCommand } from './MakeFactoryCommand';
import { MakeInterfaceCommand } from './MakeInterfaceCommand';
import { MakeJobCommand } from './MakeJobCommand';
import { MakeListenerCommand } from './MakeListenerCommand';
import { MakeMailCommand } from './MakeMailCommand';
import { MakeMiddlewareCommand } from './MakeMiddlewareCommand';
import { MakeMigrationCommand } from './MakeMigrationCommand';
import { MakeModelCommand } from './MakeModelCommand';
import { MakeNotificationCommand } from './MakeNotificationCommand';
import { MakeObserverCommand } from './MakeObserverCommand';
import { MakePolicyCommand } from './MakePolicyCommand';
import { MakeProviderCommand } from './MakeProviderCommand';
import { MakeRequestCommand } from './MakeRequestCommand';
import { MakeResourceCommand } from './MakeResourceCommand';
import { MakeRuleCommand } from './MakeRuleCommand';
import { MakeSeederCommand } from './MakeSeederCommand';
import { MakeTestCommand } from './MakeTestCommand';
import { MakeTraitCommand } from './MakeTraitCommand';
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
import { ScheduleListCommand } from './ScheduleListCommand';
import { ScheduleRunCommand } from './ScheduleRunCommand';
import { ScheduleTestCommand } from './ScheduleTestCommand';
import { ScheduleWorkCommand } from './ScheduleWorkCommand';
import { SeedCommand } from './SeedCommand';

/**
 * All application commands (migration, generator, seeder, event, queue,
 * cache, view).
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
    // Generator commands
    new MakeModelCommand(app),
    new MakeRequestCommand(app),
    new MakeMiddlewareCommand(app),
    new MakeProviderCommand(app),
    new MakeObserverCommand(app),
    new MakePolicyCommand(app),
    new MakeFactoryCommand(app),
    new MakeResourceCommand(app),
    new MakeCollectionCommand(app),
    new MakeRuleCommand(app),
    new MakeCommandCommand(app),
    new MakeTestCommand(app),
    new MakeMailCommand(app),
    new MakeNotificationCommand(app),
    new MakeCastCommand(app),
    new MakeChannelCommand(app),
    new MakeExceptionCommand(app),
    new MakeEnumCommand(app),
    new MakeInterfaceCommand(app),
    new MakeTraitCommand(app),
    new MakeClassCommand(app),
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
    // Config commands
    new ConfigCacheCommand(app),
    new ConfigClearCommand(app),
    // Schedule commands
    new ScheduleRunCommand(app),
    new ScheduleWorkCommand(app),
    new ScheduleListCommand(app),
    new ScheduleTestCommand(app),
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
