/**
 * Access - the Laravel-shaped authorization layer
 *
 * The Gate service (defined abilities + policies + before/after overrides),
 * the Response value object carrying allow/deny verdicts with message and
 * status, the AuthorizationException the exception handler renders as a
 * 403, and the Policy/HandlesAuthorization bases applications write
 * policies against.
 */

export { Gate, resolveGate } from './Gate';
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
} from './Gate';
export { Response } from './Response';
export { AuthorizationException } from './AuthorizationException';
export { Policy } from './Policy';
export { HandlesAuthorization, type AuthorizationConstructor } from './Concerns/HandlesAuthorization';
