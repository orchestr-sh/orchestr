/**
 * Gate - ability callbacks, model policies, before/after overrides and the
 * allow/deny Response: the single authorization service every request-layer
 * check funnels through.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { GateUser } from '@/Auth/Access/Gate';
import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import { AuthorizationException } from '@/Auth/Access/AuthorizationException';
import { Gate } from '@/Auth/Access/Gate';
import { Policy } from '@/Auth/Access/Policy';
import { Response } from '@/Auth/Access/Response';
import { Application } from '@/Foundation/Application';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

class Post {
  constructor(
    public id: number,
    public authorId: number | null
  ) {}
}

class Draft extends Post {}

class Article {
  constructor(
    public id: number,
    public authorId: number | null
  ) {}
}

/** The user fields the callbacks inspect, on top of the Authenticatable contract */
interface TestUser extends Authenticatable {
  admin: boolean;
}

/**
 * Build a user; the Gate only passes it along, so identifier/admin are the
 * only surface the callbacks lean on
 */
function testUser(id: number, admin: boolean = false): TestUser {
  return {
    admin,
    getAuthIdentifierName: () => 'id',
    getAuthIdentifier: () => id,
    getAuthPasswordName: () => 'password',
    getAuthPassword: () => null,
    getRememberToken: () => null,
    setRememberToken: () => {},
    getRememberTokenName: () => 'remember_token',
  };
}

const ada = testUser(1, true);
const bob = testUser(2);

class PostPolicy extends Policy {
  view(user: TestUser, post: Post): boolean {
    return post.id > 0 && user.getAuthIdentifier() !== null;
  }

  viewAny(): boolean {
    return true;
  }

  create(user: TestUser): Response | boolean {
    return user.admin ? this.allow() : this.deny('Admins may create posts.', 402);
  }

  update(user: TestUser, post: Post): Response | boolean {
    return post.authorId === user.getAuthIdentifier() ? true : this.deny('Only authors may edit posts.');
  }

  delete(user: TestUser, post: Post): boolean {
    return post.authorId === user.getAuthIdentifier();
  }
}

class ArticlePolicy extends Policy {
  update(user: TestUser, article: Article): Response | boolean {
    return article.authorId === user.getAuthIdentifier() ? true : this.deny('Only authors may edit notes.');
  }
}

describe('Gate', () => {
  let gate: Gate;
  let owned: Post;
  let orphan: Post;

  beforeEach(() => {
    gate = new Gate().resolveUsersUsing(() => bob);
    owned = new Post(1, 2);
    orphan = new Post(2, null);
  });

  describe('defined abilities', () => {
    it('runs define() callbacks through allows/denies (AC)', async () => {
      gate.define('update-post', (user, post) => user?.getAuthIdentifier() === post.authorId);

      expect(await gate.allows('update-post', owned)).toBe(true);
      expect(await gate.allows('update-post', orphan)).toBe(false);
      expect(await gate.denies('update-post', orphan)).toBe(true);
    });

    it('passes multiple arguments to the callback', async () => {
      gate.define('assign', (user, post, reviewer) => user?.getAuthIdentifier() === 2 && reviewer === 'qa');

      expect(await gate.allows('assign', [owned, 'qa'])).toBe(true);
      expect(await gate.allows('assign', [owned, 'ops'])).toBe(false);
    });

    it('authorize() returns the Response when allowed and throws on denial (AC)', async () => {
      gate.define('update-post', (user, post) => user?.getAuthIdentifier() === post.authorId);

      const allowed = await gate.authorize('update-post', owned);
      expect(allowed.allowed).toBe(true);

      await expect(gate.authorize('update-post', orphan)).rejects.toBeInstanceOf(AuthorizationException);
      await expect(gate.authorize('update-post', orphan)).rejects.toMatchObject({
        message: 'This action is unauthorized.',
      });
    });

    it('carries the denial message and status from a Response into the exception', async () => {
      gate.define('publish', () => Response.deny('Not yet.', 422));

      await expect(gate.authorize('publish')).rejects.toMatchObject({ message: 'Not yet.', status: 422 });
    });

    it('treats a returned string as a denial message', async () => {
      gate.define('reasoned', (user) => (user?.getAuthIdentifier() === 2 ? true : 'Account is not 2.'));

      expect(await gate.allows('reasoned')).toBe(true);

      const denied = await gate.forUser(ada).inspect('reasoned');
      expect(denied.allowed).toBe(false);
      expect(denied.message()).toBe('Account is not 2.');
    });

    it('inspects unknown abilities as denied', async () => {
      const response = await gate.inspect('never-defined');

      expect(response.allowed).toBe(false);
      expect(response.message()).toBeNull();
    });

    it('check/any/none aggregate multiple abilities', async () => {
      gate.define('first', () => false);
      gate.define('second', () => true);

      expect(await gate.check(['first', 'second'])).toBe(true);
      expect(await gate.any(['first', 'second'])).toBe(true);
      expect(await gate.any(['first'])).toBe(false);
      expect(await gate.none(['first'])).toBe(true);
      expect(await gate.none(['first', 'second'])).toBe(false);
    });
  });

  describe('policies', () => {
    beforeEach(() => {
      gate.policy(Post, PostPolicy);
    });

    it('resolves view/create/update/delete through policy() registration (AC)', async () => {
      expect(await gate.forUser(ada).allows('view', owned)).toBe(true);
      expect(await gate.forUser(ada).allows('create', Post)).toBe(true);
      expect(await gate.forUser(bob).allows('create', Post)).toBe(false);
      expect(await gate.allows('update', owned)).toBe(true);
      expect(await gate.allows('update', orphan)).toBe(false);
      expect(await gate.denies('delete', owned)).toBe(false);
      expect(await gate.forUser(bob).allows('delete', orphan)).toBe(false);
    });

    it('maps dashed abilities onto the policy method names', async () => {
      expect(await gate.allows('view-post', owned)).toBe(true);
      expect(await gate.forUser(bob).allows('view-any', Post)).toBe(true);
      expect(await gate.forUser(bob).allows('create-post', Post)).toBe(false);
      // An ability with no model argument cannot reach a policy
      expect(await gate.allows('view-any')).toBe(false);
    });

    it('keeps the deny message from the policy in the inspected Response', async () => {
      const response = await gate.inspect('update', orphan);

      expect(response.allowed).toBe(false);
      expect(response.message()).toBe('Only authors may edit posts.');
      await expect(gate.authorize('update', orphan)).rejects.toMatchObject({
        message: 'Only authors may edit posts.',
      });
    });

    it('denies guests on policy checks while defined abilities still run', async () => {
      const guest = new Gate();
      guest.policy(Post, PostPolicy);
      guest.define('welcome', (user) => user === null);

      expect(await guest.allows('update', owned)).toBe(false);
      expect(await guest.allows('welcome')).toBe(true);
    });

    it('getPolicyFor resolves registered and statically declared policies', () => {
      expect(gate.getPolicyFor(owned)).toBeInstanceOf(PostPolicy);
      expect(gate.hasPolicy(Post)).toBe(true);

      class Note extends Article {
        static policy = ArticlePolicy;
      }

      // The model's static `policy` override is consulted without registration
      expect(gate.getPolicyFor(new Note(1, 1))).toBeInstanceOf(ArticlePolicy);
      expect(gate.hasPolicy(new Post(3, null))).toBe(true);
    });

    it('guesses policies by convention from a configured namespace through the container', async () => {
      const app = new Application('/test');
      app.bind('App\\Policies\\ArticlePolicy', () => new ArticlePolicy());

      const withApp = new Gate(app);
      withApp.resolveUsersUsing(() => bob);
      withApp.usePolicyNamespace('App\\Policies');

      expect(withApp.hasPolicy('Article')).toBe(true);
      expect(await withApp.allows('update', new Article(1, 2))).toBe(true);
      expect(await withApp.allows('update', new Article(1, 1))).toBe(false);
    });

    it('guesses policy names through a custom guesser (OCP)', async () => {
      const app = new Application('/test');
      app.bind('EditorPolicy', () => new ArticlePolicy());

      const withApp = new Gate(app);
      withApp.resolveUsersUsing(() => bob);
      withApp.guessPolicyNamesUsing((model) => (model === 'Draft' ? ['EditorPolicy'] : [`${model}Policy`]));

      expect(withApp.hasPolicy(Draft)).toBe(true);
      expect(withApp.hasPolicy(Article)).toBe(false);
      expect(await withApp.allows('update', new Draft(1, 2))).toBe(true);
    });

    it('prefers defined abilities over policy methods of the same name', async () => {
      gate.define('delete-post', () => true);

      expect(await gate.allows('delete-post', orphan)).toBe(true);
    });
  });

  describe('before and after callbacks', () => {
    it('a before callback can override every check (AC)', async () => {
      gate.define('update-post', (user, post) => user?.getAuthIdentifier() === post.authorId);
      gate.policy(Post, PostPolicy);

      gate.before((user: GateUser) => (user && (user as TestUser).admin ? true : null));

      // The admin override wins over both callbacks and policies
      expect(await gate.forUser(ada).allows('update-post', orphan)).toBe(true);
      expect(await gate.forUser(ada).allows('update', orphan)).toBe(true);

      // Returning null falls through to the normal checks
      expect(await gate.forUser(bob).allows('update-post', owned)).toBe(true);
      expect(await gate.forUser(bob).allows('update-post', orphan)).toBe(false);
      expect(await gate.forUser(bob).allows('update', orphan)).toBe(false);
    });

    it('guests hit the before guard instead of the callback', async () => {
      gate.before((user: GateUser) => (user && (user as TestUser).admin ? true : null));

      // The admin override never sees a guest: denials stand
      expect(await gate.forUser(null).allows('update', owned)).toBe(false);
    });

    it('an after callback can amend the verdict', async () => {
      gate.define('update-post', () => true);
      gate.after((user: GateUser) => (user?.getAuthIdentifier() === 1 ? false : null));

      expect(await gate.forUser(ada).allows('update-post')).toBe(false);
      expect(await gate.forUser(bob).allows('update-post')).toBe(true);
    });

    it('before/after registrations are shared by forUser clones', async () => {
      gate.before((user: GateUser) => (user && (user as TestUser).admin ? true : null));

      expect(await gate.forUser(ada).allows('anything')).toBe(true);
      expect(await gate.forUser(bob).allows('anything')).toBe(false);
    });
  });

  describe('users and forUser', () => {
    it('checks run against the resolved user and forUser overrides it', async () => {
      gate.define('whoami', (user) => user?.getAuthIdentifier() === 2);

      expect(await gate.allows('whoami')).toBe(true);
      expect(await gate.forUser(ada).allows('whoami')).toBe(false);
      expect(await gate.forUser(ada).user()).toBe(ada);
      expect(await gate.user()).toBe(bob);
    });

    it('forUser accepts a resolver for lazy user sources', async () => {
      gate.define('whoami', (user) => user?.getAuthIdentifier() === 2);

      expect(await gate.forUser(async () => bob).allows('whoami')).toBe(true);
    });
  });
});
