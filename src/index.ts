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

// Types
export type { HttpMethod, RouteAction, Middleware } from './Routing/Route';
export type { Abstract, Concrete, Binding } from './Container/Container';
export type { CookieOptions } from './Routing/Response';
