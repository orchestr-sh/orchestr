/**
 * TestCase - boot, request, assert
 *
 * The acceptance shape of the testing framework: a TestCase subclass
 * defines routes (and providers/environment) on a tiny application, makes
 * HTTP requests through the real Kernel, and asserts the response -
 * including authentication via actingAs, sessions, cookies, redirects and
 * surfaced exceptions.
 *
 * Written in the PHPUnit-style method form: `new HttpTestCase()` collects
 * the test* methods into a describe block with full setUp/tearDown
 * isolation between tests.
 */

import { describe, it, expect } from 'vitest';
import type { AuthManager } from '@/Auth/AuthManager';
import type { Config } from '@/Foundation/Config/Config';
import { AuthServiceProvider } from '@/Auth/AuthServiceProvider';
import { SessionGuard } from '@/Auth/SessionGuard';
import { Router } from '@/Routing/Router';
import { StartSession } from '@/Session/Middleware/StartSession';
import { TestCase, TestResponse } from '@/Testing';
import { TestUser, TestUserProvider } from './support';

/**
 * Exception thrown by the /boom route with exception handling off
 */
class BoomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoomError';
  }
}

class HttpTestCase extends TestCase {
  protected providers() {
    return [...super.providers(), AuthServiceProvider];
  }

  protected defineEnvironment(config: Config): void {
    config.set('auth.defaults.guard', 'session');
    config.set('auth.guards', { session: { driver: 'memory', provider: 'users' } });
  }

  afterApplicationBoot(): void {
    super.afterApplicationBoot();

    // A memory-guard driver: SessionGuard over an in-memory provider, no
    // session backing (acting-as pins users directly)
    this.app
      .make<AuthManager>('auth')
      .extend('memory', (name) => new SessionGuard(name, new TestUserProvider(), () => null));
  }

  protected defineRoutes(router: Router): void {
    router.get('/', (_req, res) => res.send('<h1>Welcome to Orchestr</h1><p>Taylor Otwell</p>'));

    router.get('/json', (_req, res) =>
      res.send({
        ok: true,
        data: { name: 'Ada', tags: ['x', 'y'], items: [{ id: 1 }, { id: 2 }] },
      })
    );

    router.get('/redirect', (_req, res) => res.redirect('/landing'));
    router.get('/landing', (_req, res) => res.send('You have arrived'));

    router.get('/header-echo', (req, res) => res.json({ token: req.header('x-token') ?? null }));

    router.get('/cookie', (_req, res) => {
      res.cookie('flavour', 'vanilla');

      return res.send('set');
    });

    router.get('/cookie-echo', (req, res) => res.json({ flavour: req.cookie('flavour') ?? null }));

    router.post('/create', (req, res) => res.status(201).json({ ...req.all() }));
    router.put('/replace', (req, res) => res.json({ ...req.all() }));
    router.patch('/adjust', (req, res) => res.json({ ...req.all() }));
    router.delete('/remove', (_req, res) => res.status(204).send(''));
    router.post('/json-echo', (req, res) => res.json({ ...req.all() }));

    router
      .get('/me', async (req, res) => {
        const user = await req.user();

        return res.json({ id: user ? user.getAuthIdentifier() : null });
      })
      .middleware('auth');

    router
      .get('/session/read', (req, res) => res.json({ cart: req.session().get('cart') ?? null }))
      .middleware(StartSession);

    router
      .get('/session/write', (req, res) => {
        req.session().put('greeting', 'hello');

        return res.send('ok');
      })
      .middleware(StartSession);

    router
      .get('/session/errors', (req, res) => {
        req.session().put('errors', { email: ['The email has already been taken.'] });

        return res.send('ok');
      })
      .middleware(StartSession);

    router.get('/boom', () => {
      throw new BoomError('kaboom');
    });

    router.get('/not-json', (_req, res) => res.header('Content-Type', 'text/plain').send('plain text'));
  }

  // ==================== Tests ====================

  async testBootsTheApplicationAndServesRoutes() {
    expect(this.app.isBooted()).toBe(true);

    const response = await this.get('/');

    response.assertOk().assertSee('Welcome to Orchestr').assertSeeText('Taylor Otwell');
  }

  async testPostReceivesUrlencodedDataAndAssertCreated() {
    const response = await this.post('/create', { name: 'Grace' });

    response.assertCreated().assertJson({ name: 'Grace' });
  }

  async testJsonVerbsRoundTripPayloads() {
    await (await this.putJson('/replace', { name: 'Ada' })).assertOk().assertJson({ name: 'Ada' });
    await (await this.patchJson('/adjust', { name: 'Bob' })).assertOk().assertJson({ name: 'Bob' });
    await (await this.delete('/remove')).assertNoContent();
    await (
      await this.postJson('/json-echo', { nested: { deep: true } })
    )
      .assertOk()
      .assertJsonPath('nested.deep', true);
  }

  async testHeadersFlowIntoTheRequest() {
    const response = await this.withHeaders({ 'X-Token': 'secret' }).get('/header-echo');

    response.assertOk().assertJsonPath('token', 'secret');
  }

  async testAssertHeaderAndCookiesOnResponses() {
    const response = await this.get('/cookie');

    response.assertOk().assertCookie('flavour', 'vanilla').assertCookieMissing('sugar');
  }

  async testCookiesCarryBetweenRequestsLikeABrowser() {
    await this.get('/cookie');

    const echo = await this.get('/cookie-echo');

    echo.assertOk().assertJsonPath('flavour', 'vanilla');
  }

  async testFollowingRedirectsReturnsTheFinalResponse() {
    this.followingRedirects();

    const response = await this.get('/redirect');

    response.assertOk().assertSee('You have arrived').assertRedirectCount(1);
  }

  async testWithoutFollowingReturnsTheRedirectItself() {
    const response = await this.get('/redirect');

    response.assertRedirect('/landing');
  }

  async testActingAsAuthenticatesRequests() {
    const user = new TestUser({ name: 'Ada' });

    await this.actingAs(user);

    const response = await this.get('/me');

    response.assertOk().assertJsonPath('id', user.getAuthIdentifier());
  }

  async testGuestsAreRejectedByAuthRoutes() {
    const response = await this.get('/me', { Accept: 'application/json' });

    response.assertUnauthorized().assertJson({ message: 'Unauthenticated.' });
  }

  async testWithSessionSeedsTheStoreTheRouteReads() {
    this.withSession({ cart: '3 items' });

    const response = await this.get('/session/read');

    response.assertOk().assertSessionHas('cart', '3 items');
  }

  async testAssertSessionHasReadsWhatTheRouteWrote() {
    const response = await this.get('/session/write');

    response.assertSessionHas('greeting').assertSessionHas('greeting', 'hello');
  }

  async testAssertSessionHasErrors() {
    const response = await this.get('/session/errors');

    response.assertSessionHasErrors('email');
    response.assertSessionHasErrors({ email: ['The email has already been taken.'] });
    response.assertSessionHasErrors((errors: Record<string, string[]>) => errors.email.length === 1);
  }

  async testWithoutExceptionHandlingSurfacesTheOriginalError() {
    this.withoutExceptionHandling();

    await expect(this.get('/boom')).rejects.toThrow(BoomError);
  }

  async testExceptionExpectationAbsorbsTheMatchedThrow() {
    this.withoutExceptionHandling();
    this.expectException(BoomError);

    const response = await this.get('/boom');

    expect(response.status).toBe(0);
  }

  async testExceptionExpectationFailsWhenNothingThrows() {
    this.withoutExceptionHandling();
    this.expectException(BoomError);

    await expect(this.get('/')).rejects.toThrow('Expected exception [BoomError] was not thrown');
  }

  async testNotFoundStillRendersWithHandlingDisabled() {
    this.withoutExceptionHandling();

    const response = await this.get('/missing-page');

    response.assertNotFound();
  }

  async testExceptionHandlingCanBeRestored() {
    this.withoutExceptionHandling();
    this.withExceptionHandling();

    const response = await this.get('/boom');

    response.assertStatus(500).assertJsonPath('message', 'kaboom');
  }

  async testJsonAssertionsCoverPathsStructuresAndCounts() {
    const response = await this.get('/json');

    response
      .assertJsonPath('data.name', 'Ada')
      .assertJsonPath('data.items.0.id', 1)
      .assertJsonPath('data.items.*.id', (value) => typeof value === 'number')
      .assertJsonStructure({ ok: [], data: { name: [], tags: ['*'], items: { '*': { id: [] } } } })
      .assertJsonCount(2, 'data.tags')
      .assertJsonCount(2, 'data.items')
      .assertJson((json: any) => json.ok === true);
  }

  async testNonJsonResponsesAreNotFoundForJsonAssertions() {
    const response = await this.get('/not-json');

    expect(() => response.json()).toThrow(/Expected a JSON response/);
  }
}

new HttpTestCase();

describe('TestResponse (unit)', () => {
  it('assertSee escapes by default but not when told otherwise', () => {
    const html = new TestResponse({
      status: 200,
      headers: {},
      cookies: [],
      body: '<p>Taylor &amp; Friends</p>',
    });

    html.assertSee('Taylor & Friends');
    html.assertSee('Taylor &amp; Friends', false);
    expect(() => html.assertSee('Taylor & Friends', false)).toThrow();
  });

  it('reports status mismatches with the body under test', () => {
    const response = new TestResponse({ status: 404, headers: {}, cookies: [], body: 'missing' });

    expect(() => response.assertOk()).toThrow(/Expected response status code \[200\] but received 404/);
  });
});
