/**
 * Cache Module
 *
 * A complete Laravel-compatible cache system for TypeScript.
 */

// Core
export { CacheManager } from './CacheManager';
export type { CacheConfig, StoreConfig, StoreFactory } from './CacheManager';
export { CacheServiceProvider } from './CacheServiceProvider';
export { Repository } from './Repository';

// Contracts
export type { Store } from './Contracts/Store';
export type { RepositoryContract } from './Contracts/Repository';
export type { LockContract } from './Contracts/Lock';
export type { LockProvider, AtomicLockStore } from './Contracts/LockProvider';
export { isLockProvider } from './Contracts/LockProvider';
export type { CacheEventDispatcher } from './Contracts/EventDispatcher';

// Stores
export { ArrayStore } from './Stores/ArrayStore';
export { FileStore } from './Stores/FileStore';
export { DatabaseStore } from './Stores/DatabaseStore';
export { NullStore } from './Stores/NullStore';
export { RedisStore, REDIS_CACHE_LOCK_SCRIPT, REDIS_CACHE_RELEASE_SCRIPT } from './Stores/RedisStore';
export type { RedisClient } from './Stores/RedisStore';

// Locks
export { Lock } from './Locks/Lock';
export { CacheLock } from './Locks/CacheLock';
export { RedisLock } from './Locks/RedisLock';
export { LockTimeoutException } from './Locks/LockTimeoutException';

// Tags
export { TaggedCache } from './Tags/TaggedCache';
export type { TaggedCacheOptions } from './Tags/TaggedCache';
export { TagSet } from './Tags/TagSet';

// Events
export { CacheHit } from './Events/CacheHit';
export { CacheMissed } from './Events/CacheMissed';
export { KeyWritten } from './Events/KeyWritten';
export { KeyForgotten } from './Events/KeyForgotten';
export { CacheFlushed } from './Events/CacheFlushed';
