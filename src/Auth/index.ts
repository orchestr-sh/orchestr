/**
 * Auth Module
 *
 * Laravel-shaped authentication: an AuthManager reading `auth.*` config,
 * a session guard with remember-me support and a bearer token guard, both
 * sharing the UserProvider contract backed by the EnsembleUserProvider,
 * plus the 'auth'/'guest' route middleware and the Auth facade.
 */

// Core
export { AuthManager, AUTH_DEFAULTS } from './AuthManager';
export type {
  AuthConfig,
  AuthGuardConfig,
  AuthDefaultsConfig,
  AuthPasswordBrokerConfig,
  AuthManagerDependencies,
  GuardFactory,
} from './AuthManager';
export { AuthServiceProvider } from './AuthServiceProvider';
export { SessionGuard } from './SessionGuard';
export type { SessionGuardOptions } from './SessionGuard';
export { TokenGuard } from './TokenGuard';
export type { TokenGuardConfig } from './TokenGuard';
export { EnsembleUserProvider } from './EnsembleUserProvider';
export type {
  EnsembleUserProviderConfig,
  EnsembleUserInstance,
  UserProviderModel,
  UserProviderQuery,
} from './EnsembleUserProvider';
export { UserNotFoundException } from './UserNotFoundException';

// Contracts
export type { Authenticatable } from './Contracts/Authenticatable';
export type { AuthCredentials, UserProvider } from './Contracts/UserProvider';
export type { Guard, StatefulGuard } from './Contracts/Guard';

// Concerns
export { HasAuthenticatable } from './Concerns/HasAuthenticatable';
export type { AttributeCarrier, AuthenticatableInstance, ModelConstructor } from './Concerns/HasAuthenticatable';

// Middleware
export {
  Authenticate,
  makeAuthenticate,
  resolveAuthManager,
  type AuthenticateOptions,
} from './Middleware/Authenticate';
export {
  RedirectIfAuthenticated,
  makeRedirectIfAuthenticated,
  type RedirectIfAuthenticatedOptions,
} from './Middleware/RedirectIfAuthenticated';
export { resolveRedirect, type RedirectDestination } from './Middleware/RedirectResolver';
