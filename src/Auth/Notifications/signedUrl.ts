/**
 * Shared signed-URL plumbing for the authentication notifications (DRY:
 * password resets and email verification build their links exactly the
 * same way, off the router's signed URL generator and the `auth.*` config).
 *
 * Both the ResetPassword and VerifyEmail notifications hand the recipient a
 * signed link, so a forged or stale token in the query string is rejected
 * by the signature before any token lookup happens. The validity window
 * comes from configuration - `auth.passwords.<broker>.expire` for resets,
 * `auth.verification.expire` for verification - matching the window the
 * broker/repository enforce server-side.
 */

import type { Config as ConfigClass } from '@/Foundation/Config/Config';
import { getGlobalApp } from '@/Support/helpers';

/**
 * The URL-generation surface these notifications need; the Router (through
 * its UrlGenerator) satisfies it.
 */
export interface SignedUrlRouter {
  signedRoute(name: string, parameters?: Record<string, any>, expiration?: number | Date): string;
}

/**
 * Generate a signed URL for a named route, valid for the given number of
 * minutes. A non-positive window leaves the link without an `expires`
 * parameter (Laravel's permanent signedRoute).
 */
export function signedUrlFor(name: string, parameters: Record<string, any>, expirationMinutes: number): string {
  const router = resolveSignedUrlRouter();
  const expiration = expirationMinutes > 0 ? new Date(Date.now() + expirationMinutes * 60_000) : undefined;

  return router.signedRoute(name, parameters, expiration);
}

/**
 * Resolve the router that signs (and later validates) the notification
 * links; fails with guidance when no application is running.
 */
export function resolveSignedUrlRouter(): SignedUrlRouter {
  const app = getGlobalApp();

  if (!app || !app.bound('router')) {
    throw new Error(
      'Signed authentication URLs need the router: register the application router under the ' +
        "'router' container binding before sending password-reset or verification notifications."
    );
  }

  return app.make<SignedUrlRouter>('router');
}

/**
 * Read a dot-key from the application config, tolerating apps that run
 * without a config repository (the callers all have documented defaults).
 */
export function readConfig<T = any>(key: string, defaultValue: T): T {
  const app = getGlobalApp();

  if (!app || !app.bound('config')) {
    return defaultValue;
  }

  try {
    const value = app.make<ConfigClass>('config').get(key);

    return value === undefined || value === null ? defaultValue : (value as T);
  } catch {
    return defaultValue;
  }
}

/**
 * The minutes a reset link stays valid: the default broker's `expire`
 * window from `auth.passwords`, so the signed URL and the stored token
 * expire together.
 */
export function resetLinkExpirationMinutes(): number {
  const broker = readConfig<string>('auth.defaults.passwords', 'users');

  return readConfig<number>(`auth.passwords.${broker}.expire`, 60);
}

/**
 * The minutes a verification link stays valid (`auth.verification.expire`).
 */
export function verificationLinkExpirationMinutes(): number {
  return readConfig<number>('auth.verification.expire', 60);
}
