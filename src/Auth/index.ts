/**
 * Auth Module
 *
 * Laravel-shaped authentication and authorization: an AuthManager reading
 * `auth.*` config, a session guard with remember-me support and a bearer
 * token guard, both sharing the UserProvider contract backed by the
 * EnsembleUserProvider, plus the Gate authorization layer (defined
 * abilities, model policies, before/after overrides and the deny Response),
 * the 'auth'/'guest'/'can' route middleware and the Auth/Gate facades.
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

// Access (gates and policies)
export { Gate, resolveGate } from './Access/Gate';
export type {
  AbilityCallback,
  AfterCallback,
  AuthorizationResult,
  BeforeCallback,
  GateUser,
  GateUserResolver,
  PolicyModel,
  PolicyNameGuesser,
  PolicyTarget,
} from './Access/Gate';
export { Response } from './Access/Response';
export { AuthorizationException } from './Access/AuthorizationException';
export { Policy } from './Access/Policy';
export { HandlesAuthorization, type AuthorizationConstructor } from './Access/Concerns/HandlesAuthorization';

// Middleware
export {
  Authenticate,
  makeAuthenticate,
  resolveAuthManager,
  type AuthenticateOptions,
} from './Middleware/Authenticate';
export { Can, makeCan } from './Middleware/Can';
export {
  RedirectIfAuthenticated,
  makeRedirectIfAuthenticated,
  type RedirectIfAuthenticatedOptions,
} from './Middleware/RedirectIfAuthenticated';
export { resolveRedirect, type RedirectDestination } from './Middleware/RedirectResolver';
