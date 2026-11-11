/**
 * Hashing Module
 *
 * Password hashing behind the Hasher contract: a HashManager with built-in
 * scrypt (node:crypto, default), bcrypt and argon2 drivers (each optional
 * peer dependency), the Hash facade and the hash() helper reaching the
 * manager through the container.
 */

// Core
export { HashManager, HASHING_DEFAULTS } from './HashManager';
export type { HashingConfig, HasherFactory } from './HashManager';
export { HashServiceProvider } from './HashServiceProvider';
export { HashDriverUnavailableException } from './HashDriverUnavailableException';

// Contracts
export type { Hasher, HashInfo } from './Contracts/Hasher';

// Drivers
export { ScryptHasher } from './ScryptHasher';
export type { ScryptOptions } from './ScryptHasher';
export { BcryptHasher } from './BcryptHasher';
export type { BcryptOptions, BcryptModule } from './BcryptHasher';
export { ArgonHasher } from './ArgonHasher';
export type { Argon2Options, Argon2Module } from './ArgonHasher';
