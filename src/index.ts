/**
 * Laravel-Next - A 1:1 Laravel replica in TypeScript
 * Main exports
 */

// Foundation
export { Application } from './Foundation/Application';
export { ServiceProvider } from './Foundation/ServiceProvider';
export { Kernel } from './Foundation/Http/Kernel';
export { FormRequest } from './Foundation/Http/FormRequest';
export { ValidationException } from './Foundation/Http/ValidationException';
export { Validator } from './Foundation/Http/Validator';
export type { ValidationRules, ValidationRule, ValidationRuleObject } from './Foundation/Http/Validator';
export { Config as ConfigClass } from './Foundation/Config/Config';
export { ConfigServiceProvider } from './Foundation/Config/ConfigServiceProvider';

// Container
export { Container } from './Container/Container';

// Routing
export { Router } from './Routing/Router';
export { Route as RouteClass } from './Routing/Route';
export { Request } from './Routing/Request';
export { Response } from './Routing/Response';
export { Controller } from './Routing/Controller';

// Facades
export { Facade } from './Support/Facade';
export { Route } from './Facades/Route';
export { Config } from './Facades/Config';
export { Event as EventFacade } from './Facades/Event';
export { Queue as QueueFacade } from './Facades/Queue';
export { Bus } from './Facades/Bus';
export { Cache } from './Facades/Cache';

// Helpers
export { loadRoutes, base_path, routes_path } from './Support/helpers';

// Decorators
export { Injectable } from './Support/Injectable';
export { ValidateRequest } from './Support/ValidateRequest';

// Helper function for config
export { config } from './Support/helpers';

// Providers
export { RouteServiceProvider } from './Providers/RouteServiceProvider';
export { DatabaseServiceProvider } from './Database/DatabaseServiceProvider';
export { QueueServiceProvider } from './Queue/QueueServiceProvider';
export { CacheServiceProvider } from './Cache/CacheServiceProvider';

// Database
export { DatabaseManager } from './Database/DatabaseManager';
export { Connection } from './Database/Connection';
export { Builder as QueryBuilder } from './Database/Query/Builder';
export { Expression, raw } from './Database/Query/Expression';
export { DrizzleAdapter } from './Database/Adapters/DrizzleAdapter';

// Database Facades
export { DB } from './Facades/DB';

// Ensemble ORM
export { Ensemble } from './Database/Ensemble/Ensemble';
export { EnsembleBuilder } from './Database/Ensemble/EnsembleBuilder';
export { EnsembleCollection } from './Database/Ensemble/EnsembleCollection';
export { softDeletes } from './Database/Ensemble/SoftDeletes';

// Ensemble Relations
export { Relation, HasOne, HasMany, BelongsTo, BelongsToMany } from './Database/Ensemble/Relations';

// Polymorphic Relations
export { MorphMap, MorphOne, MorphMany, MorphTo, MorphToMany, MorphedByMany } from './Database/Ensemble/Relations';

// Ensemble Concerns
export { HasRelationshipsMixin } from './Database/Ensemble/Concerns/HasRelationships';
export { DynamicRelation, defineDynamicRelation } from './Database/Ensemble/Concerns/HasDynamicRelations';
export type {
  DynamicRelationAccessor,
  BelongsToAccessor,
  HasOneAccessor,
  HasManyAccessor,
  BelongsToManyAccessor,
  MorphOneAccessor,
  MorphManyAccessor,
  MorphToAccessor,
  MorphToManyAccessor,
  MorphedByManyAccessor,
} from './Database/Ensemble/Concerns/HasDynamicRelations';

// Ensemble Types
export type {
  HasAttributes,
  CastType,
  AttributeMutator,
  AttributeAccessor,
} from './Database/Ensemble/Concerns/HasAttributes';
export type { HasTimestamps } from './Database/Ensemble/Concerns/HasTimestamps';
export type { SoftDeletes } from './Database/Ensemble/SoftDeletes';
export type { RelationshipConfig } from './Database/Ensemble/Concerns/HasRelationships';

// Database Migrations
export { Migration } from './Database/Migrations/Migration';
export { MigrationRepository } from './Database/Migrations/MigrationRepository';
export { Migrator } from './Database/Migrations/Migrator';
export { MigrationCreator } from './Database/Migrations/MigrationCreator';
export { SchemaBuilder } from './Database/Migrations/SchemaBuilder';
export { Blueprint as BlueprintBuilder } from './Database/Migrations/Blueprint';
export { ColumnDefinition as ColumnDefinitionBuilder } from './Database/Migrations/ColumnDefinition';
export { ForeignKeyDefinition as ForeignKeyDefinitionBuilder } from './Database/Migrations/ForeignKeyDefinition';

// Database Seeders
export { Seeder } from './Database/Seeders/Seeder';
export { SeederRunner } from './Database/Seeders/SeederRunner';

// Console
export { Command } from './Console/Command';
export { ConsoleKernel } from './Console/ConsoleKernel';

// Console Commands - Migrations
export { MigrateCommand } from './Console/Commands/MigrateCommand';
export { MigrateRollbackCommand } from './Console/Commands/MigrateRollbackCommand';
export { MigrateResetCommand } from './Console/Commands/MigrateResetCommand';
export { MigrateRefreshCommand } from './Console/Commands/MigrateRefreshCommand';
export { MigrateFreshCommand } from './Console/Commands/MigrateFreshCommand';
export { MigrateStatusCommand } from './Console/Commands/MigrateStatusCommand';
export { MakeMigrationCommand } from './Console/Commands/MakeMigrationCommand';

// Console Commands - Seeders
export { SeedCommand } from './Console/Commands/SeedCommand';
export { MakeSeederCommand } from './Console/Commands/MakeSeederCommand';

// Console Commands - Events
export { MakeEventCommand } from './Console/Commands/MakeEventCommand';
export { MakeListenerCommand } from './Console/Commands/MakeListenerCommand';
export { EventListCommand } from './Console/Commands/EventListCommand';
export { EventCacheCommand } from './Console/Commands/EventCacheCommand';
export { EventClearCommand } from './Console/Commands/EventClearCommand';

// Console Commands - Queue
export { QueueWorkCommand } from './Console/Commands/QueueWorkCommand';
export { QueueRestartCommand } from './Console/Commands/QueueRestartCommand';
export { QueueFailedCommand } from './Console/Commands/QueueFailedCommand';
export { QueueRetryCommand } from './Console/Commands/QueueRetryCommand';
export { QueueForgetCommand } from './Console/Commands/QueueForgetCommand';
export { QueueFlushCommand } from './Console/Commands/QueueFlushCommand';
export { QueueClearCommand } from './Console/Commands/QueueClearCommand';
export { QueueMonitorCommand } from './Console/Commands/QueueMonitorCommand';
export { QueueTableCommand } from './Console/Commands/QueueTableCommand';
export { QueueFailedTableCommand } from './Console/Commands/QueueFailedTableCommand';
export { QueueBatchesTableCommand } from './Console/Commands/QueueBatchesTableCommand';
export { QueuePruneBatchesCommand } from './Console/Commands/QueuePruneBatchesCommand';
export { QueuePruneFailedCommand } from './Console/Commands/QueuePruneFailedCommand';
export { MakeJobCommand } from './Console/Commands/MakeJobCommand';

// Console Commands - Cache
export { CacheClearCommand } from './Console/Commands/CacheClearCommand';
export { CacheForgetCommand } from './Console/Commands/CacheForgetCommand';
export { CacheTableCommand } from './Console/Commands/CacheTableCommand';

// Database Types
export type { DatabaseAdapter, DatabaseConfig, QueryResult } from './Database/Contracts/DatabaseAdapter';
export type {
  QueryBuilderInterface,
  WhereOperator,
  OrderDirection,
  JoinType,
  WhereClause,
  JoinClause,
  OrderByClause,
} from './Database/Contracts/QueryBuilderInterface';
export type { Schema, Blueprint, ColumnDefinition, ForeignKeyDefinition } from './Database/Contracts/Schema';
export type { DatabaseManagerConfig, DatabaseConnectionConfig } from './Database/DatabaseManager';

// Console Types
export type { CommandOptions } from './Console/Command';
export type { MigrationOptions } from './Database/Migrations/Migrator';
export type { MigrationData } from './Database/Migrations/MigrationRepository';

// Events
export { Event } from './Events/Event';
export type { EventClass } from './Events/Event';
export { Dispatcher } from './Events/Dispatcher';
export { EventServiceProvider } from './Events/EventServiceProvider';
export { Dispatchable, applyDispatchable } from './Events/Concerns/Dispatchable';

// Model Events
export {
  ModelEvent,
  ModelRetrieved,
  ModelCreating,
  ModelCreated,
  ModelUpdating,
  ModelUpdated,
  ModelSaving,
  ModelSaved,
  ModelDeleting,
  ModelDeleted,
} from './Database/Ensemble/Events';

// Event Contracts & Types
export type { DispatcherContract } from './Events/Contracts/Dispatcher';
export type { EventListener, EventSubscriber, ListenerInterface, ListenerClosure, EventPayload, QueuedListener } from './Events/types';

// Queue
export { Job } from './Queue/Job';
export type { JobClass } from './Queue/Job';
export { QueueManager } from './Queue/QueueManager';
export type { QueueConfig, QueueConnectionConfig, QueueFailedConfig, QueueBatchingConfig } from './Queue/QueueManager';
export { PendingDispatch as QueuePendingDispatch } from './Queue/PendingDispatch';
export { PendingChain } from './Queue/PendingChain';
export { JobPayload } from './Queue/JobPayload';

// Queue Contracts
export type { QueueableJob } from './Queue/Contracts/QueueableJob';
export type { QueueDriver, QueueDriverJob } from './Queue/Contracts/QueueDriver';
export type { ShouldBeUnique, ShouldBeUniqueUntilProcessing } from './Queue/Contracts/ShouldBeUnique';
export { isShouldBeUnique } from './Queue/Contracts/ShouldBeUnique';

// Queue Drivers
export { SyncDriver } from './Queue/Drivers/SyncDriver';
export { DatabaseDriver as DatabaseQueueDriver } from './Queue/Drivers/DatabaseDriver';
export { NullDriver as NullQueueDriver } from './Queue/Drivers/NullDriver';

// Queue Workers
export { Worker } from './Queue/Workers/Worker';
export type { WorkerOptions } from './Queue/Workers/WorkerOptions';

// Queue Middleware
export type { JobMiddleware } from './Queue/Middleware/JobMiddleware';
export { RateLimited } from './Queue/Middleware/RateLimited';
export { WithoutOverlapping } from './Queue/Middleware/WithoutOverlapping';
export { ThrottlesExceptions } from './Queue/Middleware/ThrottlesExceptions';

// Queue Failed Jobs
export type { FailedJobProvider, FailedJobRecord } from './Queue/Failed/FailedJobProvider';
export { DatabaseFailedJobProvider } from './Queue/Failed/DatabaseFailedJobProvider';

// Queue Batching
export { Batch } from './Queue/Batching/Batch';
export { PendingBatch } from './Queue/Batching/PendingBatch';

// Queue Events
export { JobQueued } from './Queue/Events/JobQueued';
export { JobProcessing } from './Queue/Events/JobProcessing';
export { JobProcessed } from './Queue/Events/JobProcessed';
export { JobFailed } from './Queue/Events/JobFailed';
export { JobExceptionOccurred } from './Queue/Events/JobExceptionOccurred';
export { JobRetryRequested } from './Queue/Events/JobRetryRequested';
export { WorkerStopping } from './Queue/Events/WorkerStopping';

// Listener Queue Contract
export { isShouldQueue } from './Listeners/Contracts/ShouldQueue';
export type { ShouldQueue } from './Listeners/Contracts/ShouldQueue';

// Cache
export { CacheManager } from './Cache/CacheManager';
export type { CacheConfig, StoreConfig, StoreFactory } from './Cache/CacheManager';
export { Repository as CacheRepository } from './Cache/Repository';

// Cache Contracts
export type { Store as CacheStore } from './Cache/Contracts/Store';
export type { RepositoryContract as CacheRepositoryContract } from './Cache/Contracts/Repository';
export type { LockContract } from './Cache/Contracts/Lock';

// Cache Stores
export { ArrayStore } from './Cache/Stores/ArrayStore';
export { FileStore } from './Cache/Stores/FileStore';
export { DatabaseStore as DatabaseCacheStore } from './Cache/Stores/DatabaseStore';
export { NullStore as NullCacheStore } from './Cache/Stores/NullStore';

// Cache Locks
export { Lock as CacheLockBase } from './Cache/Locks/Lock';
export { CacheLock } from './Cache/Locks/CacheLock';
export { LockTimeoutException } from './Cache/Locks/LockTimeoutException';

// Cache Tags
export { TaggedCache } from './Cache/Tags/TaggedCache';
export { TagSet } from './Cache/Tags/TagSet';

// Cache Events
export { CacheHit } from './Cache/Events/CacheHit';
export { CacheMissed } from './Cache/Events/CacheMissed';
export { KeyWritten } from './Cache/Events/KeyWritten';
export { KeyForgotten } from './Cache/Events/KeyForgotten';
export { CacheFlushed } from './Cache/Events/CacheFlushed';

// Types
export type { HttpMethod, RouteAction, Middleware } from './Routing/Route';
export type { Abstract, Concrete, Binding } from './Container/Container';
export type { CookieOptions } from './Routing/Response';
