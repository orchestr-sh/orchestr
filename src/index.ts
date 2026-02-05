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

// Helpers
export { loadRoutes, base_path, routes_path } from './Support/helpers';

// Decorators
export { Injectable } from './Support/Injectable';

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
export { Relation, HasOne, HasMany, BelongsTo } from './Database/Ensemble/Relations';

// Ensemble Concerns
export { HasRelationshipsMixin } from './Database/Ensemble/Concerns/HasRelationships';

// Ensemble Types
export type { HasAttributes, CastType, AttributeMutator, AttributeAccessor } from './Database/Ensemble/Concerns/HasAttributes';
export type { HasTimestamps } from './Database/Ensemble/Concerns/HasTimestamps';
export type { SoftDeletes } from './Database/Ensemble/SoftDeletes';
export type { RelationshipConfig } from './Database/Ensemble/Concerns/HasRelationships';

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
export type {
  Schema,
  Blueprint,
  ColumnDefinition,
  ForeignKeyDefinition,
} from './Database/Contracts/Schema';
export type {
  DatabaseManagerConfig,
  DatabaseConnectionConfig,
} from './Database/DatabaseManager';

// Types
export type { HttpMethod, RouteAction, Middleware } from './Routing/Route';
export type { Abstract, Concrete, Binding } from './Container/Container';
export type { CookieOptions } from './Routing/Response';
