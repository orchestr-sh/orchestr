/**
 * Shared building blocks for the Testing suite.
 *
 * A minimal in-memory user + provider pair so the auth tests exercise
 * guards and middleware without a database, mirroring the shape
 * EnsembleUserProvider expects.
 */

import type { Authenticatable } from '@/Auth/Contracts/Authenticatable';
import type { AuthCredentials, UserProvider } from '@/Auth/Contracts/UserProvider';

/**
 * A fake authenticatable user, attribute-bag style
 */
export class TestUser implements Authenticatable {
  static rows: Map<string, TestUser> = new Map();
  static nextId = 1;

  attributes: Record<string, any> = {};

  constructor(attributes: Record<string, any> = {}) {
    this.attributes = { id: TestUser.nextId++, ...attributes };
    TestUser.rows.set(String(this.attributes.id), this);
  }

  static reset(): void {
    TestUser.rows.clear();
    TestUser.nextId = 1;
  }

  getAttribute(key: string): any {
    return this.attributes[key];
  }

  setAttribute(key: string, value: any): void {
    this.attributes[key] = value;
  }

  getAuthIdentifierName(): string {
    return 'id';
  }

  getAuthIdentifier(): any {
    return this.attributes.id ?? null;
  }

  getAuthPasswordName(): string {
    return 'password';
  }

  getAuthPassword(): string | null {
    return this.attributes.password ?? null;
  }

  getRememberToken(): string | null {
    return this.attributes.remember_token ?? null;
  }

  setRememberToken(token: string | null): void {
    this.attributes.remember_token = token;
  }

  getRememberTokenName(): string {
    return 'remember_token';
  }
}

/**
 * An in-memory user provider: retrieval by id/credentials against
 * TestUser.rows, no hashing (tests that pin users never call
 * validateCredentials).
 */
export class TestUserProvider implements UserProvider {
  constructor(protected readonly users: Map<string, TestUser> = TestUser.rows) {}

  async retrieveById(identifier: any): Promise<Authenticatable | null> {
    return this.users.get(String(identifier)) ?? null;
  }

  async retrieveByToken(identifier: any, token: string): Promise<Authenticatable | null> {
    const user = this.users.get(String(identifier));

    return user && user.getRememberToken() === token ? user : null;
  }

  async updateRememberToken(user: Authenticatable, token: string | null): Promise<void> {
    user.setRememberToken(token);
  }

  async retrieveByCredentials(credentials: AuthCredentials): Promise<Authenticatable | null> {
    for (const user of this.users.values()) {
      const matches = Object.entries(credentials)
        .filter(([key]) => key !== 'password')
        .every(([key, value]) => user.getAttribute(key) === value);

      if (matches) {
        return user;
      }
    }

    return null;
  }

  async validateCredentials(user: Authenticatable, credentials: AuthCredentials): Promise<boolean> {
    return user.getAuthPassword() === credentials.password;
  }
}
