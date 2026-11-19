/**
 * Password reset route helpers
 *
 * The framework half of Laravel's Breeze auth routes for password resets:
 * register the `password.email`, `password.reset` and `password.update`
 * endpoints against the application's router with the conventional paths,
 * names and middleware, so an app gets the full flow with one call from a
 * routes file. Apps that want their own controllers or paths pass them
 * through the options - the names stay what ResetPassword signs its URLs
 * against (`password.reset`), so overriding paths is safe (DRY with
 * registerBroadcastRoutes' pattern).
 *
 * The signed GET form route validates its signature by default: the reset
 * link is mailed signed, so a hand-typed or tampered URL is rejected with
 * a 403 before the token is ever presented. The POST update endpoint does
 * not need the signature - it authenticates the request with the token
 * itself, like Laravel's skeleton.
 *
 * @example
 * ```typescript
 * registerPasswordResetRoutes(router);
 *
 * // POST /forgot-password        -> password.email
 * // GET  /reset-password/:token  -> password.reset (signed)
 * // POST /reset-password         -> password.update
 * ```
 */

import type { MiddlewareArgument } from '@/Routing/Pipeline';
import type { Route, RouteAction } from '@/Routing/Route';
import type { Router } from '@/Routing/Router';
import { RedirectIfAuthenticated } from '@/Auth/Middleware/RedirectIfAuthenticated';
import { ValidateSignature } from '@/Routing/Middleware/ValidateSignature';
import { Request } from '@/Routing/Request';
import { ResponseObject } from '@/Routing/Responses';
import { NewPasswordController } from './NewPasswordController';
import { PasswordResetLinkController } from './PasswordResetLinkController';

export interface PasswordResetRouteOptions {
  /**
   * Middleware wrapped around every reset route. Defaults to the 'guest'
   * behaviour (Breeze keeps authenticated visitors off the forms).
   */
  middleware?: MiddlewareArgument | MiddlewareArgument[];

  /**
   * Validate the signature on the GET form route (default true; the
   * mailed link is signed, so keeping it on turns stray links into a 403).
   */
  signed?: boolean;

  /** Path of the POST that mails a reset link */
  emailPath?: string;

  /** Path of the GET that renders the reset form (token placeholder included) */
  resetPath?: string;

  /** Path of the POST that performs the reset */
  updatePath?: string;

  /**
   * Override the reset form action (a view, a JSON payload, anything);
   * receives the request with the `token` route parameter filled.
   */
  formAction?: RouteAction;

  /** Override the mail-a-link controller action (default the shipped PasswordResetLinkController) */
  linkAction?: RouteAction;

  /** Override the update controller action (default the shipped NewPasswordController) */
  updateAction?: RouteAction;
}

/**
 * Register the password reset routes and their names.
 * Laravel: the Breeze `password.*` route group.
 */
export function registerPasswordResetRoutes(
  router: Router,
  options: PasswordResetRouteOptions = {}
): { email: Route; reset: Route; update: Route } {
  const middleware = options.middleware ?? RedirectIfAuthenticated;
  const emailPath = options.emailPath ?? '/forgot-password';
  const resetPath = options.resetPath ?? '/reset-password/:token';
  const updatePath = options.updatePath ?? '/reset-password';

  const email = router.post(emailPath, options.linkAction ?? ([PasswordResetLinkController, 'store'] as RouteAction));
  router.name('password.email', email);

  const form: RouteAction = options.formAction ?? ((request: Request) => defaultResetForm(request, updatePath));

  const reset = router.get(resetPath, form);
  router.name('password.reset', reset);

  const update = router.post(updatePath, options.updateAction ?? ([NewPasswordController, 'store'] as RouteAction));
  router.name('password.update', update);

  for (const route of [email, reset, update]) {
    route.middleware(middleware);
  }

  if (options.signed !== false) {
    reset.middleware(ValidateSignature);
  }

  return { email, reset, update };
}

/**
 * The built-in reset form: a minimal HTML page that posts the token, the
 * address and the new password back to `password.update`. Apps wanting
 * their own markup pass `formAction` - this is the framework-shape
 * fallback so the mailed link is followable without a view system.
 */
function defaultResetForm(request: Request, updatePath: string): ResponseObject {
  const token = String(request.routeParam('token') ?? '');
  const email = String(request.input('email') ?? '');

  const html =
    '<h1>Reset Password</h1>' +
    `<form method="POST" action="${escapeHtmlAttribute(updatePath)}">` +
    `<input type="email" name="email" value="${escapeHtmlAttribute(email)}">` +
    `<input type="hidden" name="token" value="${escapeHtmlAttribute(token)}">` +
    '<input type="password" name="password" autocomplete="new-password">' +
    '<input type="password" name="password_confirmation" autocomplete="new-password">' +
    '<button type="submit">Reset Password</button>' +
    '</form>';

  return new ResponseObject(html, 200, { 'Content-Type': 'text/html' });
}

/**
 * Escape a value for embedding in HTML attributes (the form echoes the
 * token/email from the URL back into the markup).
 */
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
