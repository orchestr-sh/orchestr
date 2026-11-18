/**
 * Email verification route helpers
 *
 * The framework half of Laravel's Fortify verification routes: register
 * the `verification.notice`, `verification.verify` and `verification.send`
 * endpoints with the conventional paths, names and middleware in one call.
 *
 * The verify endpoint runs the signature check (`signed`) plus a
 * 6-attempts-per-minute throttle, exactly like Fortify's route group; the
 * resend endpoint is authenticated (the `auth` middleware) and throttled
 * the same way. The middleware objects are wired directly (not through
 * alias strings) so registering these routes never depends on the app's
 * Kernel alias table - apps that prefer the alias spellings can override
 * every group through the options.
 *
 * @example
 * ```typescript
 * registerEmailVerificationRoutes(router);
 *
 * // GET  /email/verify                 -> verification.notice (auth)
 * // GET  /email/verify/:id/:hash       -> verification.verify  (signed + throttle)
 * // POST /email/verification-notification -> verification.send (auth + throttle)
 * ```
 */

import type { Middleware, MiddlewareArgument } from '@/Routing/Pipeline';
import type { Request } from '@/Routing/Request';
import type { Route } from '@/Routing/Route';
import type { Router } from '@/Routing/Router';
import { Authenticate } from '@/Auth/Middleware/Authenticate';
import { makeThrottleRequests } from '@/Routing/Middleware/ThrottleRequests';
import { makeValidateSignature } from '@/Routing/Middleware/ValidateSignature';
import {
  EmailVerificationNotificationController,
  EmailVerificationPromptController,
  VerifyEmailController,
  type VerificationControllerOptions,
} from './EmailVerificationControllers';

export interface EmailVerificationRouteOptions extends VerificationControllerOptions {
  /**
   * Middleware wrapped around the notice and resend endpoints. Defaults
   * to the container-driven `auth` middleware (guests get 401/redirect,
   * like Fortify's group).
   */
  middleware?: MiddlewareArgument | MiddlewareArgument[];

  /**
   * Middleware for the signed verify endpoint. Defaults to the signature
   * validation plus `resendThrottle`; pass your own to replace both.
   */
  verifyMiddleware?: MiddlewareArgument | MiddlewareArgument[];

  /** Path of the GET notice endpoint */
  noticePath?: string;

  /** Path of the GET verify endpoint (must carry :id and :hash placeholders) */
  verifyPath?: string;

  /** Path of the POST resend endpoint */
  sendPath?: string;

  /**
   * Resend throttling: max attempts per decay window (minutes), matching
   * Fortify's `throttle:6,1` default.
   */
  resendThrottle?: { max?: number; decayMinutes?: number };
}

/**
 * Register the email verification routes and their names.
 * Laravel: the Fortify verification route group.
 */
export function registerEmailVerificationRoutes(
  router: Router,
  options: EmailVerificationRouteOptions = {}
): { notice: Route; verify: Route; send: Route } {
  const middleware = options.middleware ?? Authenticate;
  const noticePath = options.noticePath ?? '/email/verify';
  const verifyPath = options.verifyPath ?? '/email/verify/:id/:hash';
  const sendPath = options.sendPath ?? '/email/verification-notification';

  const controllerOptions: VerificationControllerOptions = { redirectTo: options.redirectTo ?? '/' };
  const { max = 6, decayMinutes = 1 } = options.resendThrottle ?? {};

  const throttle: Middleware = (req, res, next) =>
    makeThrottleRequests()(req, res, next, String(max), String(decayMinutes));

  const verifyMiddleware = options.verifyMiddleware ?? [makeValidateSignature(), throttle];

  const prompt = new EmailVerificationPromptController(controllerOptions);
  const notice = router.get(noticePath, (request: Request) => prompt.show(request));
  router.name('verification.notice', notice);

  const verifyController = new VerifyEmailController(controllerOptions);
  const verify = router.get(verifyPath, (request: Request) => verifyController.verify(request));
  router.name('verification.verify', verify);

  const resend = new EmailVerificationNotificationController(controllerOptions);
  const send = router.post(sendPath, (request: Request) => resend.store(request));
  router.name('verification.send', send);

  const authMiddleware: MiddlewareArgument[] = Array.isArray(middleware) ? middleware : [middleware];

  notice.middleware(authMiddleware);
  send.middleware([...authMiddleware, throttle]);
  verify.middleware(verifyMiddleware);

  return { notice, verify, send };
}
