/**
 * Auth Module
 *
 * Laravel-shaped authentication and authorization: an AuthManager reading
 * `auth.*` config, a session guard with remember-me support and a bearer
 * token guard, both sharing the UserProvider contract backed by the
 * EnsembleUserProvider, plus the Gate authorization layer (defined
 * abilities, model policies, before/after overrides and the deny Response),
 * the 'auth'/'guest'/'can'/'verified' route middleware and the Auth/Gate/
 * Password facades. Password resets (broker + hashed-token repository +
 * signed-link notification + Breeze-style routes) and email verification
 * (MustVerifyEmail concern + signed verification URLs + the
 * verification.* endpoints) complete the flow.
 */

// Core
export { AuthManager, AUTH_DEFAULTS } from './AuthManager';
export type {
  AuthConfig,
  AuthGuardConfig,
  AuthDefaultsConfig,
  AuthPasswordBrokerConfig,
  AuthVerificationConfig,
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
export type { CanResetPassword, PasswordResettable } from './Contracts/CanResetPassword';
export type { MustVerifyEmail, Verifiable } from './Contracts/MustVerifyEmail';

// Concerns
export { HasAuthenticatable } from './Concerns/HasAuthenticatable';
export type { AttributeCarrier, AuthenticatableInstance, ModelConstructor } from './Concerns/HasAuthenticatable';
export { HasPasswordReset } from './Concerns/HasPasswordReset';
export type { PasswordResetMethods, PasswordResettableInstance } from './Concerns/HasPasswordReset';
export { HasVerifiedEmail } from './Concerns/HasVerifiedEmail';
export type { VerifiedEmailInstance, VerifiedEmailMethods, VerifiableCarrier } from './Concerns/HasVerifiedEmail';

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

// Password resets (broker, repositories, controllers, routes)
export { PasswordBroker } from './Passwords/PasswordBroker';
export type { BrokerUser, PasswordBrokerStatus, ResettableInstance, ResetCallback } from './Passwords/PasswordBroker';
export { PasswordBrokerManager } from './Passwords/PasswordBrokerManager';
export type {
  PasswordBrokerDependencies,
  PasswordResetDatabase,
  TokenRepositoryFactory,
} from './Passwords/PasswordBrokerManager';
export { DatabaseTokenRepository } from './Passwords/DatabaseTokenRepository';
export type {
  DatabaseTokenRepositoryConfig,
  PasswordResetTableResolver,
  PasswordResetTokenQuery,
} from './Passwords/DatabaseTokenRepository';
export { PasswordResetServiceProvider } from './Passwords/PasswordResetServiceProvider';
export { PasswordResetLinkController } from './Passwords/PasswordResetLinkController';
export { NewPasswordController } from './Passwords/NewPasswordController';
export { registerPasswordResetRoutes } from './Passwords/routes';
export type { PasswordResetRouteOptions } from './Passwords/routes';
export { PASSWORD_MESSAGES, resetOutcome, respondWithOutcome, sendLinkOutcome } from './Passwords/statusResponse';
export type { BrokerOutcome } from './Passwords/statusResponse';

// Email verification (request, controllers, routes)
export { EmailVerificationRequest, resolveVerificationProvider } from './Requests/EmailVerificationRequest';
export type { VerifiableUser } from './Requests/EmailVerificationRequest';
export {
  EmailVerificationNotificationController,
  EmailVerificationPromptController,
  VERIFICATION_NOTICE_MESSAGE,
  VerifyEmailController,
} from './Verification/EmailVerificationControllers';
export type { VerificationControllerOptions } from './Verification/EmailVerificationControllers';
export { registerEmailVerificationRoutes } from './Verification/routes';
export type { EmailVerificationRouteOptions } from './Verification/routes';

// Notifications
export { ResetPassword } from './Notifications/ResetPassword';
export { emailVerificationHash, VerifyEmail } from './Notifications/VerifyEmail';
export { AuthenticationMail } from './Notifications/AuthenticationMail';
export type { AuthenticationMailContent } from './Notifications/AuthenticationMail';
export {
  readConfig,
  resetLinkExpirationMinutes,
  resolveSignedUrlRouter,
  signedUrlFor,
  verificationLinkExpirationMinutes,
} from './Notifications/signedUrl';
export type { SignedUrlRouter } from './Notifications/signedUrl';

// Middleware
export {
  Authenticate,
  makeAuthenticate,
  resolveAuthManager,
  type AuthenticateOptions,
} from './Middleware/Authenticate';
export { Can, makeCan } from './Middleware/Can';
export {
  EnsureEmailIsVerified,
  makeEnsureEmailIsVerified,
  VERIFICATION_MESSAGE,
  type EnsureEmailIsVerifiedOptions,
} from './Middleware/EnsureEmailIsVerified';
export {
  RedirectIfAuthenticated,
  makeRedirectIfAuthenticated,
  type RedirectIfAuthenticatedOptions,
} from './Middleware/RedirectIfAuthenticated';
export { resolveRedirect, type RedirectDestination } from './Middleware/RedirectResolver';
