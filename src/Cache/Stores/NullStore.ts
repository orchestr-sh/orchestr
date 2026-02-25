/**
 * NullStore
 *
 * A no-op cache store that discards all values.
 * Useful for disabling caching in certain environments.
 *
 * Mirrors Laravel's Illuminate\Cache\NullStore.
 */

import type { Store } from '@/Cache/Contracts/Store';

export class NullStore implements Store {
  async get<T = any>(_key: string): Promise<T | null> {
    return null;
  }

  async many<T = any>(keys: string[]): Promise<Record<string, T | null>> {
    const result: Record<string, T | null> = {};
    for (const key of keys) {
      result[key] = null;
    }
    return result;
  }

  async put<T = any>(_key: string, _value: T, _seconds: number): Promise<boolean> {
    return false;
  }

  async putMany<T = any>(_values: Record<string, T>, _seconds: number): Promise<boolean> {
    return false;
  }

  async increment(_key: string, _value?: number): Promise<number | boolean> {
    return false;
  }

  async decrement(_key: string, _value?: number): Promise<number | boolean> {
    return false;
  }

  async forever<T = any>(_key: string, _value: T): Promise<boolean> {
    return false;
  }

  async forget(_key: string): Promise<boolean> {
    return true;
  }

  async flush(): Promise<boolean> {
    return true;
  }

  getPrefix(): string {
    return '';
  }
}
