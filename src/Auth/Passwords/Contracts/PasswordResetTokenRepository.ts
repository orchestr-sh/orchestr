/**
 * PasswordBroker token repository contract
 *
 * The seam between the broker and wherever reset tokens live: the broker
 * owns the flow (SRP) and delegates storage - creating, checking and
 * deleting tokens - to an implementation of this contract, mirroring
 * Laravel's `Illuminate\Auth\Passwords\TokenRepositoryInterface`. The
 * DatabaseTokenRepository ships built-in; custom stores (cache, Dynamo,
 * in-memory tests) register through PasswordBrokerManager::extend().
 */

import type { CanResetPassword } from '@/Auth/Contracts/CanResetPassword';

/**
 * A stored reset token, as the table row describes it: the address, the
 * *hashed* token and the unix-second creation timestamp.
 */
export interface PasswordResetTokenRecord {
  email: string;
  token: string;
  created_at: number;
}

/**
 * One stored token plus the raw value. `create()` hands the broker the
 * record with the plain-text token filled in - only the stored copy is
 * hashed - so the broker can mail it without re-reading the table.
 */
export interface CreatedPasswordResetToken extends PasswordResetTokenRecord {
  /** The raw token to mail; never stored */
  plainTextToken: string;
}

/**
 * The repository contract: create, check, delete and throttle reset tokens.
 * Laravel: TokenRepositoryInterface (+ recentlyCreatedToken)
 */
export interface PasswordResetTokenRepository {
  /**
   * Store a fresh reset token for the user and hand back the raw value to
   * mail.
   */
  create(user: CanResetPassword): Promise<CreatedPasswordResetToken>;

  /**
   * Whether a (non-expired) token matching the user exists for the raw
   * value.
   */
  exists(user: CanResetPassword, token: string): Promise<boolean>;

  /**
   * Drop every stored token for the user (used after a successful reset).
   */
  delete(user: CanResetPassword): Promise<void>;

  /**
   * Whether a token was created for the user inside the throttle window -
   * the "one link per minute" guard Laravel applies before re-sending.
   */
  recentlyCreatedToken(user: CanResetPassword): Promise<boolean>;
}
