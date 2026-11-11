/**
 * Authorization over HTTP - the 'can' middleware answers denials with a
 * 403 through the exception handler, Rule.can validates through the same
 * Gate, FormRequest.authorize() failures render 403 (not 500), and
 * Request.can/cannot/authorize consult the shared service.
 */

import { createAuthApp, MemoryUser, testHasher } from '@tests/Auth/support';
import { cookieValue, createRawRequest, handle } from '@tests/Session/support';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Gate } from '@/Auth/Access/Gate';
import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { ValidationRules } from '@/Foundation/Http/Validator';
import { AuthorizationException } from '@/Auth/Access/AuthorizationException';
import { Policy } from '@/Auth/Access/Policy';
import { Response } from '@/Auth/Access/Response';
import { Gate as GateFacade } from '@/Facades/Gate';
import { Application } from '@/Foundation/Application';
import { FormRequest } from '@/Foundation/Http/FormRequest';
import { Rule } from '@/Foundation/Http/Rule';
import { Validator } from '@/Foundation/Http/Validator';
import { Controller } from '@/Routing/Controller';
import { Request } from '@/Routing/Request';
import { StartSession } from '@/Session/Middleware/StartSession';
import { ArraySessionStore } from '@/Session/Stores/ArraySessionStore';
import { Facade } from '@/Support/Facade';
import { Injectable } from '@/Support/Injectable';
import { ValidateRequest } from '@/Support/ValidateRequest';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

class Post {
  constructor(
    public id: number,
    public authorId: number | null
  ) {}
}

const posts: Post[] = [new Post(1, 1), new Post(2, null)];

class PostPolicy extends Policy {
  create(user: Authenticatable): boolean {
    return user.getAuthIdentifier() === 1;
  }

  update(user: Authenticatable, post: Post): Response | boolean {
    return post.authorId === user.getAuthIdentifier() ? true : this.deny('Only authors may edit posts.');
  }

  delete(user: Authenticatable, post: Post): boolean {
    return post.authorId === user.getAuthIdentifier();
  }
}

/** Boolean denial renders the generic 403 */
class DeniedThingRequest extends FormRequest {
  protected authorize(): boolean {
    return false;
  }

  protected rules(): ValidationRules {
    return {};
  }
}

/** Gate-backed denial through Request.authorize, carrying the policy message */
class UpdatePostRequest extends FormRequest {
  protected authorize(): Promise<boolean | Response> | boolean | Response {
    const post = this.routeParam('post');

    return post ? this.request.authorize('update', post) : true;
  }

  protected rules(): ValidationRules {
    return { title: 'required|string' };
  }
}

/** Rule.can validation consults the same gate as the middleware */
class PublishPostRequest extends FormRequest {
  protected rules(): ValidationRules {
    return { title: ['required', Rule.can('update', posts[0])] };
  }
}

@Injectable()
class PostController extends Controller {
  @ValidateRequest()
  async update(request: UpdatePostRequest) {
    return { updated: true, title: request.input('title') };
  }

  @ValidateRequest()
  async publish(request: PublishPostRequest) {
    return { published: true };
  }
}

@Injectable()
class ThingController extends Controller {
  @ValidateRequest()
  async deny(request: DeniedThingRequest) {
    return { unreachable: true };
  }
}

describe('HTTP authorization', () => {
  let context: Awaited<ReturnType<typeof createAuthApp>>;
  let gate: Gate;

  beforeEach(async () => {
    MemoryUser.reset();
    ArraySessionStore.clear();

    context = await createAuthApp();
    const { app, router, kernel } = context;

    gate = app.make<Gate>('gate');
    gate.policy(Post, PostPolicy);

    kernel.use(StartSession);

    await MemoryUser.create({ email: 'ada@example.com', name: 'Ada', password: testHasher().make('secret') });
    await MemoryUser.create({ email: 'bob@example.com', name: 'Bob', password: testHasher().make('secret') });

    router.bind('post', (value: any) => posts.find((post) => post.id === Number(value)) ?? null);

    router.post('/login', async (req: any, res: any) => {
      await context.auth.forRequest(req, res).attempt(req.only(['email', 'password']), false);

      return { ok: true };
    });

    // The classic pairing: authenticate, then authorize by route-bound model
    router
      .get('/posts/:post/edit', (req: any) => ({ editing: req.route('post').id }))
      .middleware(['auth', 'can:update,post']);

    router
      .get('/who-can', async (req: any) => ({
        can: await req.can('update', posts[0]),
        cannot: await req.cannot('update', posts[1]),
      }))
      .middleware('auth');

    // Gate without a preceding auth middleware: the request user is a guest
    router.get('/posts/:post/bare', () => ({ reached: true })).middleware('can:update,post');

    // Model-less checks: the class reference reaches the policy create method
    router.get('/create', () => ({ created: true })).middleware(['auth', 'can:create,Post']);

    router.put('/posts/:post', [PostController, 'update']).middleware('auth');
    router.post('/publish', [PostController, 'publish']).middleware('auth');
    router.post('/denied-thing', [ThingController, 'deny']);
  });

  afterEach(() => {
    Facade.setFacadeApplication(undefined as unknown as Application);
    Facade.clearResolvedInstances();
  });

  async function login(email: string): Promise<string> {
    const res = await handle(context.kernel, 'POST', '/login', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'secret' }),
    });

    expect(res.status).toBe(200);

    return `orchestr_session=${cookieValue(res.cookies, 'orchestr_session')!}`;
  }

  describe("the 'can' middleware", () => {
    it('runs the action when the ability passes (AC)', async () => {
      const cookie = await login('ada@example.com');

      const res = await handle(context.kernel, 'GET', '/posts/1/edit', { headers: { cookie } });

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ editing: 1 });
    });

    it('answers 403 with the policy denial message (AC)', async () => {
      const cookie = await login('bob@example.com');

      const res = await handle(context.kernel, 'GET', '/posts/1/edit', {
        headers: { cookie, accept: 'application/json' },
      });

      expect(res.status).toBe(403);
      expect(JSON.parse(res.body)).toEqual({ message: 'Only authors may edit posts.' });
    });

    it('answers 403 for guests with the default message', async () => {
      const res = await handle(context.kernel, 'GET', '/posts/1/bare', { headers: { accept: 'application/json' } });

      expect(res.status).toBe(403);
      expect(JSON.parse(res.body)).toEqual({ message: 'This action is unauthorized.' });
    });

    it('passes the model class reference to policy create', async () => {
      const admin = await login('ada@example.com');

      const ok = await handle(context.kernel, 'GET', '/create', { headers: { cookie: admin } });
      expect(ok.status).toBe(200);

      const bob = await login('bob@example.com');
      const denied = await handle(context.kernel, 'GET', '/create', {
        headers: { cookie: bob, accept: 'application/json' },
      });
      expect(denied.status).toBe(403);
    });

    it('lets before overrides clear the middleware', async () => {
      const cookie = await login('bob@example.com');

      gate.before((user) => (user?.getAuthIdentifier() === 2 ? true : null));

      const res = await handle(context.kernel, 'GET', '/posts/1/edit', { headers: { cookie } });

      expect(res.status).toBe(200);
    });
  });

  describe('Rule.can', () => {
    it('validates through the gate inside a form request (AC)', async () => {
      const cookie = await login('ada@example.com');

      const ok = await handle(context.kernel, 'POST', '/publish', {
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'hello' }),
      });
      expect(ok.status).toBe(200);

      const bobCookie = await login('bob@example.com');
      const denied = await handle(context.kernel, 'POST', '/publish', {
        headers: { cookie: bobCookie, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ title: 'hello' }),
      });

      expect(denied.status).toBe(422);
      expect(JSON.parse(denied.body).errors.title).toContain('Only authors may edit posts.');
    });

    it('fails standalone validation with the gate denial message', async () => {
      gate.resolveUsersUsing(() => MemoryUser.rows.get('2') ?? null);

      const validator = new Validator({ title: 'x' }, { title: Rule.can('update', posts[0]) });

      expect(await validator.validate()).toBe(false);
      expect(validator.errors().title).toEqual(['Only authors may edit posts.']);
    });

    it('passes when the gate says yes', async () => {
      gate.resolveUsersUsing(() => MemoryUser.rows.get('1') ?? null);

      const validator = new Validator({ title: 'x' }, { title: Rule.can('update', posts[0]) });

      expect(await validator.validate()).toBe(true);
    });

    it('keeps required semantics alongside the gate check', async () => {
      gate.resolveUsersUsing(() => MemoryUser.rows.get('1') ?? null);

      const validator = new Validator({}, { title: ['required', Rule.can('update', posts[0])] });

      expect(await validator.validate()).toBe(false);
      expect(validator.errors().title).toEqual(['The title field is required.']);
    });
  });

  describe('FormRequest.authorize()', () => {
    it('throws AuthorizationException on boolean denial', async () => {
      const request = new DeniedThingRequest(new Request(createRawRequest('POST', '/denied-thing')));

      await expect(request.validate()).rejects.toBeInstanceOf(AuthorizationException);
      await expect(request.validate()).rejects.toMatchObject({ message: 'This action is unauthorized.' });
    });

    it('renders boolean denials as 403, not a generic 500 (AC)', async () => {
      const res = await handle(context.kernel, 'POST', '/denied-thing');

      expect(res.status).toBe(403);
      expect(JSON.parse(res.body)).toEqual({ message: 'This action is unauthorized.' });
    });

    it('runs the action for the authorized owner', async () => {
      const cookie = await login('ada@example.com');

      const res = await handle(context.kernel, 'PUT', '/posts/1', {
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'hello' }),
      });

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ updated: true, title: 'hello' });
    });

    it('renders gate denials from authorize() with the policy message', async () => {
      const cookie = await login('bob@example.com');

      const res = await handle(context.kernel, 'PUT', '/posts/1', {
        headers: { cookie, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ title: 'hello' }),
      });

      expect(res.status).toBe(403);
      expect(JSON.parse(res.body)).toEqual({ message: 'Only authors may edit posts.' });
    });

    it('denies guests hitting the same route', async () => {
      const res = await handle(context.kernel, 'PUT', '/posts/1', {
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ title: 'hello' }),
      });

      // The auth middleware answers guests with 401 before validation runs
      expect(res.status).toBe(401);
    });
  });

  describe('Request.can/cannot/authorize', () => {
    it('answers gate verdicts for the authenticated user', async () => {
      const cookie = await login('ada@example.com');

      const res = await handle(context.kernel, 'GET', '/who-can', { headers: { cookie } });

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ can: true, cannot: true });
    });

    it('can() denies guests without a bound user resolver', async () => {
      const request = new Request(createRawRequest('GET', '/'));

      expect(await request.can('update', posts[0])).toBe(false);
      expect(await request.cannot('update', posts[0])).toBe(true);
      await expect(request.authorize('update', posts[0])).rejects.toBeInstanceOf(AuthorizationException);
    });
  });

  describe('the shared gate', () => {
    it('exposes the service through the Gate facade', async () => {
      Facade.setFacadeApplication(context.app);
      Facade.clearResolvedInstances();

      GateFacade.define('facade-ability', (user) => user?.getAuthIdentifier() === 7);

      const lucky = { getAuthIdentifier: () => 7 } as Authenticatable;

      expect(await GateFacade.forUser(lucky).allows('facade-ability')).toBe(true);
      expect(await GateFacade.allows('facade-ability')).toBe(false);
      expect(gate.getAbilities()).toContain('facade-ability');
    });

    it('maps AuthorizationException onto 403 and custom statuses', async () => {
      context.router.get('/gate/raw', () => {
        throw new AuthorizationException('Nope.');
      });

      const res = await handle(context.kernel, 'GET', '/gate/raw', { headers: { accept: 'application/json' } });

      expect(res.status).toBe(403);
      expect(JSON.parse(res.body)).toEqual({ message: 'Nope.' });

      context.router.get('/gate/status', () => {
        throw AuthorizationException.withStatus('Gone.', 410);
      });

      const custom = await handle(context.kernel, 'GET', '/gate/status', { headers: { accept: 'application/json' } });

      expect(custom.status).toBe(410);
      expect(JSON.parse(custom.body)).toEqual({ message: 'Gone.' });
    });
  });
});
