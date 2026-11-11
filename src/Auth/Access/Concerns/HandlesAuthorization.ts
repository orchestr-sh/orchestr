/**
 * HandlesAuthorization Concern
 *
 * The port of the trait Laravel policy classes reach for to build
 * authorization responses: `allow()` and `deny()` hand back
 * `Auth\Access\Response` objects so a policy method can attach a failure
 * message (`return $this->deny('Only authors may edit posts.')`) instead of
 * a bare boolean.
 *
 * Apply it to any policy base class; the `Policy` abstraction composes it
 * for one-off policies.
 *
 * Laravel: Illuminate\Auth\Access\Concerns\HandlesAuthorization
 *
 * @example
 * ```typescript
 * class PostPolicy extends Policy {
 *   update(user: Authenticatable, post: Post) {
 *     return post.authorId === user.getAuthIdentifier() ? this.allow() : this.deny('Only authors may edit posts.');
 *   }
 * }
 * ```
 */

import { Response } from '../Response';

/**
 * Any class constructor, so the concern can wrap existing policy bases
 */
export type AuthorizationConstructor = abstract new (...args: any[]) => any;

export function HandlesAuthorization(Base: AuthorizationConstructor = class {}) {
  abstract class HandlesAuthorizationMixin extends Base {
    /**
     * Authorize the action, with an optional message
     * Laravel: $this->allow()
     */
    allow(message: string | null = null): Response {
      return Response.allow(message);
    }

    /**
     * Deny the action with an optional message and HTTP status
     * Laravel: $this->deny($message, $status)
     */
    deny(message: string | null = null, status: number | null = null): Response {
      return Response.deny(message, status);
    }
  }

  return HandlesAuthorizationMixin;
}
