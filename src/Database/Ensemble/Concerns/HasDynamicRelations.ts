/**
 * HasDynamicRelations Concern
 *
 * Provides dynamic relationship access similar to PHP's __get magic method
 * Allows accessing relationships as properties: user.posts instead of user.posts().get()
 */

import { Relation } from '../Relations';

/**
 * Check if a value is a Relation instance
 */
function isRelation(value: any): boolean {
  return value && value instanceof Relation;
}

/**
 * Create a hybrid function/promise for relationship access
 * This allows both: await user.posts AND user.posts().get()
 */
function createRelationshipProxy(relationGetter: () => any): any {
  // Create a function that returns the relation when called
  const fn: any = function (...args: any[]) {
    return relationGetter();
  };

  // Make the function thenable (Promise-like) by adding then/catch methods
  fn.then = function (onFulfilled?: any, onRejected?: any) {
    return relationGetter().getResults().then(onFulfilled, onRejected);
  };

  fn.catch = function (onRejected?: any) {
    return relationGetter().getResults().catch(onRejected);
  };

  fn.finally = function (onFinally?: any) {
    return relationGetter().getResults().finally(onFinally);
  };

  return fn;
}

/**
 * List of method prefixes that should never be treated as relationships
 */
const EXCLUDED_PREFIXES = [
  'get',
  'set',
  'is',
  'has',
  'should',
  'can',
  'fill',
  'save',
  'delete',
  'update',
  'create',
  'find',
  'where',
  'with',
  'load',
  'fresh',
  'toObject',
  'toJSON',
  'toString',
  'valueOf',
];

/**
 * List of known internal methods that should never be treated as relationships
 */
const EXCLUDED_METHODS = [
  'constructor',
  'getTable',
  'getKeyName',
  'getKey',
  'getAttribute',
  'setAttribute',
  'newQuery',
  'newInstance',
  'getConnection',
  'query',
  'getDirty',
  'relationLoaded',
  'getRelation',
  'setRelation',
  'syncOriginal',
  'refresh',
  'touch',
  'makeHidden',
  'makeVisible',
];

/**
 * Check if a method name should be excluded from dynamic relation detection
 */
function shouldExcludeMethod(methodName: string): boolean {
  // Exclude if in the excluded methods list
  if (EXCLUDED_METHODS.includes(methodName)) {
    return true;
  }

  // Exclude if it starts with an underscore (private/internal)
  if (methodName.startsWith('_')) {
    return true;
  }

  // Exclude if it starts with any excluded prefix
  for (const prefix of EXCLUDED_PREFIXES) {
    if (methodName.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

/**
 * Wrap an Ensemble instance with a Proxy that automatically resolves relationships
 */
/**
 * List of internal properties that should never be proxied
 */
const INTERNAL_PROPERTIES = new Set([
  'attributes',
  'original',
  'relations',
  'exists',
  'wasRecentlyCreated',
  'table',
  'primaryKey',
  'incrementing',
  'keyType',
  'fillable',
  'guarded',
  'hidden',
  'visible',
  'appends',
  'casts',
  'timestamps',
  'connection',
  'dynamicRelations',
]);

export function withDynamicRelations<T extends object>(instance: T): T {
  return new Proxy(instance, {
    get(target: any, property: string | symbol, receiver: any): any {
      // Always pass through symbol properties and internal properties
      // Use target directly, not receiver, to avoid proxy recursion
      if (typeof property === 'symbol' || INTERNAL_PROPERTIES.has(property as string)) {
        return target[property];
      }

      // Get the original value from target, not receiver
      const value = target[property];

      // Check if dynamic relations are enabled for this instance
      const dynamicEnabled = target.dynamicRelations === true;

      // If dynamic relations are disabled or it's not a string property, return as-is
      if (!dynamicEnabled || typeof property !== 'string') {
        return value;
      }

      // If it's not a function, return as-is
      if (typeof value !== 'function') {
        return value;
      }

      // Exclude methods that should never be treated as relationships
      if (shouldExcludeMethod(property)) {
        return value;
      }

      // Check if this property is a loaded relation
      if (target.relationLoaded && target.relationLoaded(property)) {
        return target.getRelation(property);
      }

      // For relationship methods (zero-parameter functions), return a hybrid proxy
      // The proxy will lazily call the method when needed (when awaited or called)
      const boundMethod = value.bind(target);
      const paramCount = value.length;

      // Only create proxy for zero-parameter methods (potential relationships)
      if (paramCount === 0) {
        // Return a hybrid that can be both called and awaited
        // We don't call the method here - we let the proxy call it when needed
        return createRelationshipProxy(boundMethod);
      }

      // Return the original value for methods with parameters
      return value;
    },

    // Pass through set operations without interference
    set(target: any, property: string | symbol, value: any, receiver: any): boolean {
      return Reflect.set(target, property, value, receiver);
    },
  });
}

/**
 * Mix dynamic relations functionality into a class
 */
export abstract class HasDynamicRelationsMixin {
  /**
   * Enable dynamic relationship access
   * Call this in your model constructor after super()
   */
  protected enableDynamicRelations(): this {
    return withDynamicRelations(this);
  }
}

/**
 * Type for a dynamic relation that can be both called and awaited
 * @deprecated Use the relation return type directly and let the decorator handle the dual behavior
 */
export type DynamicRelationAccessor<T> = (() => any) & PromiseLike<T>;

/**
 * Type helper for dynamic relations
 * Use this to type relationship properties that work both as methods and promises
 *
 * @example
 * class Post extends Ensemble {
 *   declare user: BelongsToAccessor<User, this>;
 *
 *   @DynamicRelation
 *   user(): BelongsTo<User, this> {
 *     return this.belongsTo(User);
 *   }
 * }
 *
 * const user = await post.user; // Type: User
 * const query = post.user(); // Type: BelongsTo<User, Post>
 */
export type BelongsToAccessor<
  TRelated extends import('../Ensemble').Ensemble,
  TParent extends import('../Ensemble').Ensemble,
> = TRelated | Promise<TRelated | null> | (() => import('../Relations/BelongsTo').BelongsTo<TRelated, TParent>);

export type HasOneAccessor<
  TRelated extends import('../Ensemble').Ensemble,
  TParent extends import('../Ensemble').Ensemble,
> = TRelated | Promise<TRelated | null> | (() => import('../Relations/HasOne').HasOne<TRelated, TParent>);

export type HasManyAccessor<
  TRelated extends import('../Ensemble').Ensemble,
  TParent extends import('../Ensemble').Ensemble,
> = TRelated[] | Promise<TRelated[]> | (() => import('../Relations/HasMany').HasMany<TRelated, TParent>);

export type BelongsToManyAccessor<
  TRelated extends import('../Ensemble').Ensemble,
  TParent extends import('../Ensemble').Ensemble,
> = TRelated[] | Promise<TRelated[]> | (() => import('../Relations/BelongsToMany').BelongsToMany<TRelated, TParent>);

export type MorphOneAccessor<
  TRelated extends import('../Ensemble').Ensemble,
  TParent extends import('../Ensemble').Ensemble,
> = TRelated | Promise<TRelated | null> | (() => import('../Relations/MorphOne').MorphOne<TRelated, TParent>);

export type MorphManyAccessor<
  TRelated extends import('../Ensemble').Ensemble,
  TParent extends import('../Ensemble').Ensemble,
> = TRelated[] | Promise<TRelated[]> | (() => import('../Relations/MorphMany').MorphMany<TRelated, TParent>);

export type MorphToAccessor<TRelated extends import('../Ensemble').Ensemble> =
  | TRelated
  | Promise<TRelated | null>
  | (() => import('../Relations/MorphTo').MorphTo<any>);

export type MorphToManyAccessor<
  TRelated extends import('../Ensemble').Ensemble,
  TParent extends import('../Ensemble').Ensemble,
> = TRelated[] | Promise<TRelated[]> | (() => import('../Relations/MorphToMany').MorphToMany<TRelated, TParent>);

export type MorphedByManyAccessor<
  TRelated extends import('../Ensemble').Ensemble,
  TParent extends import('../Ensemble').Ensemble,
> = TRelated[] | Promise<TRelated[]> | (() => import('../Relations/MorphedByMany').MorphedByMany<TRelated, TParent>);

/**
 * Decorator to convert a relationship method into a dynamic property
 *
 * @example
 * class Post extends Ensemble {
 *   @DynamicRelation
 *   user!: DynamicRelationAccessor<User>;
 *   user(): BelongsTo<User, this> {
 *     return this.belongsTo(User, 'user_id');
 *   }
 *
 *   @DynamicRelation
 *   comments!: DynamicRelationAccessor<Comment[]>;
 *   comments(): HasMany<Comment, this> {
 *     return this.hasMany(Comment);
 *   }
 * }
 *
 * // Now you can use:
 * const user = await post.user;  // Type: User
 * const comments = await post.comments;  // Type: Comment[]
 */
export function DynamicRelation(value: any, context?: any) {
  // Modern decorator (TypeScript 5+ with context as second parameter)
  if (context && context.kind === 'method') {
    context.addInitializer(function (this: any) {
      const methodName = context.name;
      const originalMethod = value;

      // Define a getter on the instance
      Object.defineProperty(this, methodName, {
        get() {
          const relation = originalMethod.call(this);

          const fn: any = function (...args: any[]) {
            return relation;
          };

          fn.then = function (resolve?: any, reject?: any) {
            return relation.getResults().then(resolve, reject);
          };

          fn.catch = function (reject?: any) {
            return relation.getResults().catch(reject);
          };

          fn.finally = function (onFinally?: any) {
            return relation.getResults().finally(onFinally);
          };

          return fn;
        },
        configurable: true,
        enumerable: false,
      });
    });

    return value;
  }

  // Legacy decorator (target, propertyKey, descriptor)
  const target = value;
  const propertyKey = context;
  const descriptor = arguments[2] as PropertyDescriptor;

  if (descriptor && typeof descriptor === 'object' && 'value' in descriptor) {
    const originalMethod = descriptor.value;

    delete descriptor.value;
    delete descriptor.writable;

    descriptor.get = function (this: any) {
      const relation = originalMethod.call(this);

      const fn: any = function (...args: any[]) {
        return relation;
      };

      fn.then = function (resolve?: any, reject?: any) {
        return relation.getResults().then(resolve, reject);
      };

      fn.catch = function (reject?: any) {
        return relation.getResults().catch(reject);
      };

      fn.finally = function (onFinally?: any) {
        return relation.getResults().finally(onFinally);
      };

      return fn;
    };

    return descriptor;
  }

  return value;
}

/**
 * Helper to define dynamic relation getters programmatically
 * Use this if you can't use decorators
 */
export function defineDynamicRelation<T>(target: T, relationName: string, relationMethod: () => any): void {
  Object.defineProperty(target, relationName, {
    get(this: any) {
      const relation = relationMethod.call(this);

      const fn: any = function (...args: any[]) {
        return relation;
      };

      fn.then = function (resolve?: any, reject?: any) {
        return relation.getResults().then(resolve, reject);
      };

      fn.catch = function (reject?: any) {
        return relation.getResults().catch(reject);
      };

      fn.finally = function (onFinally?: any) {
        return relation.getResults().finally(onFinally);
      };

      return fn;
    },
    enumerable: false,
    configurable: true,
  });
}
