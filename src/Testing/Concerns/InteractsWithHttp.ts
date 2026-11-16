/**
 * InteractsWithHttp
 *
 * The request-building half of the test API: verb methods, default
 * headers/cookies, session seeding, acting-as and redirect following.
 * Every method delegates to the TestClient - which drives the
 * application's own Kernel - so the HTTP surface of TestCase and the
 * client never diverge (DRY).
 *
 * Mirrors Illuminate\Foundation\Testing\Concerns\MakesHttpRequests plus
 * the acting-as entry of InteractsWithAuthentication.
 */

import type { AuthManager } from '@/Auth/AuthManager';
import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { TestApplicationConstructor } from '@/Testing/contracts';
import type { TestResponse } from '@/Testing/TestResponse';

export function InteractsWithHttp<T extends TestApplicationConstructor>(Base: T) {
  abstract class InteractsWithHttpMixin extends Base {
    // ==================== Request customization ====================

    /**
     * Add default headers to every subsequent request
     * Laravel: withHeaders
     */
    withHeaders(headers: Record<string, string>): this {
      this.client.withHeaders(headers);
      return this;
    }

    /**
     * Add one default header
     * Laravel: withHeader
     */
    withHeader(name: string, value: string): this {
      this.client.withHeader(name, value);
      return this;
    }

    /**
     * Send a bearer token on every subsequent request
     * Laravel: withToken
     */
    withToken(token: string): this {
      this.client.withToken(token);
      return this;
    }

    /**
     * Add default cookies to every subsequent request
     * Laravel: withCookies
     */
    withCookies(cookies: Record<string, string>): this {
      this.client.withCookies(cookies);
      return this;
    }

    /**
     * Seed session data carried by the next request; the values land in a
     * real session the application resumes via the session cookie
     * Laravel: withSession
     */
    withSession(data: Record<string, any>): this {
      this.client.withSession(data);
      return this;
    }

    /**
     * Follow redirect responses instead of returning them
     * Laravel: followingRedirects
     */
    followingRedirects(): this {
      this.client.followingRedirects();
      return this;
    }

    /**
     * Authenticate subsequent requests as the given user without walking
     * the login flow
     * Laravel: actingAs
     */
    async actingAs(user: Authenticatable, guard?: string): Promise<this> {
      await this.setUp();

      if (!this.app.bound('auth')) {
        throw new Error('Cannot act as a user: register the AuthServiceProvider before calling actingAs().');
      }

      this.app.make<AuthManager>('auth').actingAs(user, guard);

      return this;
    }

    /**
     * Stop resolving the acting-as user for a guard
     * Laravel: the inverse of actingAs (fresh app between tests)
     */
    async flushActingAs(guard?: string): Promise<this> {
      await this.setUp();

      if (this.app.bound('auth')) {
        this.app.make<AuthManager>('auth').forgetActingAs(guard);
      }

      return this;
    }

    // ==================== Verbs ====================

    /**
     * GET a URI through the kernel
     * Laravel: get
     */
    async get(uri: string, headers: Record<string, string> = {}): Promise<TestResponse> {
      await this.setUp();

      return this.client.get(uri, headers);
    }

    /**
     * HEAD a URI
     * Laravel: head
     */
    async head(uri: string, headers: Record<string, string> = {}): Promise<TestResponse> {
      await this.setUp();

      return this.client.head(uri, headers);
    }

    /**
     * OPTIONS a URI
     * Laravel: options
     */
    async options(uri: string, headers: Record<string, string> = {}): Promise<TestResponse> {
      await this.setUp();

      return this.client.options(uri, headers);
    }

    /**
     * POST urlencoded data
     * Laravel: post
     */
    async post(
      uri: string,
      data: Record<string, any> | string = {},
      headers: Record<string, string> = {}
    ): Promise<TestResponse> {
      await this.setUp();

      return this.client.post(uri, data, headers);
    }

    /**
     * PUT urlencoded data
     * Laravel: put
     */
    async put(
      uri: string,
      data: Record<string, any> | string = {},
      headers: Record<string, string> = {}
    ): Promise<TestResponse> {
      await this.setUp();

      return this.client.put(uri, data, headers);
    }

    /**
     * PATCH urlencoded data
     * Laravel: patch
     */
    async patch(
      uri: string,
      data: Record<string, any> | string = {},
      headers: Record<string, string> = {}
    ): Promise<TestResponse> {
      await this.setUp();

      return this.client.patch(uri, data, headers);
    }

    /**
     * DELETE a resource
     * Laravel: delete
     */
    async delete(
      uri: string,
      data: Record<string, any> | string = {},
      headers: Record<string, string> = {}
    ): Promise<TestResponse> {
      await this.setUp();

      return this.client.delete(uri, data, headers);
    }

    /**
     * POST a JSON payload (also sets `Accept: application/json`)
     * Laravel: postJson
     */
    async postJson(
      uri: string,
      data: Record<string, any> = {},
      headers: Record<string, string> = {}
    ): Promise<TestResponse> {
      await this.setUp();

      return this.client.postJson(uri, data, headers);
    }

    /**
     * PUT a JSON payload
     * Laravel: putJson
     */
    async putJson(
      uri: string,
      data: Record<string, any> = {},
      headers: Record<string, string> = {}
    ): Promise<TestResponse> {
      await this.setUp();

      return this.client.putJson(uri, data, headers);
    }

    /**
     * PATCH a JSON payload
     * Laravel: patchJson
     */
    async patchJson(
      uri: string,
      data: Record<string, any> = {},
      headers: Record<string, string> = {}
    ): Promise<TestResponse> {
      await this.setUp();

      return this.client.patchJson(uri, data, headers);
    }

    /**
     * DELETE with a JSON payload
     * Laravel: deleteJson
     */
    async deleteJson(
      uri: string,
      data: Record<string, any> = {},
      headers: Record<string, string> = {}
    ): Promise<TestResponse> {
      await this.setUp();

      return this.client.deleteJson(uri, data, headers);
    }

    /**
     * Any verb with a JSON payload
     * Laravel: json
     */
    async json(
      method: string,
      uri: string,
      data: Record<string, any> = {},
      headers: Record<string, string> = {}
    ): Promise<TestResponse> {
      await this.setUp();

      return this.client.json(method, uri, data, headers);
    }

    /**
     * The fully generic call through the kernel
     * Laravel: call
     */
    async call(
      method: string,
      uri: string,
      options: { headers?: Record<string, string>; body?: Record<string, any> | string; json?: boolean } = {}
    ): Promise<TestResponse> {
      await this.setUp();

      return this.client.call(method, uri, options);
    }
  }

  return InteractsWithHttpMixin;
}
