/**
 * BroadcastController - the channel-authorization endpoint.
 *
 * Mirrors Illuminate\Broadcasting\BroadcastController: a client subscribing to
 * a private/presence channel POSTs its `channel_name` and `socket_id` here, the
 * active broadcaster verifies access through the registered channel callbacks,
 * and the driver's `auth` response is returned. The controller owns only the
 * HTTP shape - reading the request, requiring a channel name (422 otherwise)
 * and answering 403 when authorization denies the socket - while the
 * decision itself stays in the broadcasting layer (SRP).
 */

import type { BroadcastManager } from '@/Broadcasting/BroadcastManager';
import type { Request } from '@/Routing/Request';
import { AuthorizationException } from '@/Auth/Access/AuthorizationException';
import { Controller } from '@/Routing/Controller';
import { JsonResponse } from '@/Routing/Responses';
import { getGlobalApp } from '@/Support/helpers';

/**
 * Resolve the application's broadcast manager from the container.
 */
export function resolveBroadcastManager(): BroadcastManager {
  const app = getGlobalApp();

  if (!app || !app.bound('broadcast')) {
    throw new Error('Broadcasting is not available. Register the BroadcastServiceProvider first.');
  }

  return app.make<BroadcastManager>('broadcast');
}

export class BroadcastController extends Controller {
  /**
   * Authenticate the incoming channel-subscription request.
   * Laravel: BroadcastController::authenticate($request)
   */
  async authenticate(request: Request): Promise<JsonResponse> {
    const manager = this.manager();
    const channelName = request.input('channel_name');
    const socketId = request.input('socket_id');

    if (typeof channelName !== 'string' || channelName === '') {
      return new JsonResponse({ message: 'The channel_name field is required.' }, 422);
    }

    const authorization = await manager.auth({
      channelName,
      socketId: socketId ?? null,
      user: await request.user(),
    });

    return new JsonResponse(authorization ?? {}, 200);
  }

  /**
   * Authenticate the connecting user itself (the presence/user-auth endpoint).
   * Laravel: BroadcastController::authenticateUser($request)
   */
  async authenticateUser(request: Request): Promise<JsonResponse> {
    const user = await request.user();

    if (!user) {
      throw new AuthorizationException('Unauthenticated.');
    }

    const id =
      typeof (user as any).getAuthIdentifier === 'function'
        ? (user as any).getAuthIdentifier()
        : ((user as any).id ?? null);

    return new JsonResponse({ id }, 200);
  }

  /**
   * The manager under test: overridable for a controller built directly,
   * otherwise resolved from the running application.
   */
  protected manager(): BroadcastManager {
    return resolveBroadcastManager();
  }
}
