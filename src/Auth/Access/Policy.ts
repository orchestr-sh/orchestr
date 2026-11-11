/**
 * Policy - the base class application policies extend
 *
 * Bundles the HandlesAuthorization helpers so `this.allow()` and
 * `this.deny('Only authors may edit posts.')` are available out of the box.
 * Policy methods mirror the Laravel resource verbs (viewAny, view, create,
 * update, delete, restore, forceDelete) plus any custom ability: each
 * receives the authenticated user first, then the arguments the Gate was
 * checked with. A method may return a boolean, a string (used as the denial
 * message) or a Response.
 *
 * Laravel: the plain policy classes Illuminate\Auth\Access\Gate resolves
 * policies against.
 *
 * @example
 * ```typescript
 * class PostPolicy extends Policy {
 *   update(user: Authenticatable, post: Post): boolean {
 *     return post.authorId === user.getAuthIdentifier();
 *   }
 * }
 *
 * Gate.policy(Post, PostPolicy);
 * ```
 */

import { HandlesAuthorization } from './Concerns/HandlesAuthorization';

export abstract class Policy extends HandlesAuthorization() {}
