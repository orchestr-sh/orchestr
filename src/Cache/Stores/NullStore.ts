/**
 * NullStore
 *
 * A no-op cache store that discards all values.
 * Useful for disabling caching in certain environments.
 *
 * Mirrors Laravel's Illuminate\Cache\NullStore.
 */

import type { Store } from '../Contracts/Store';

export class NullStore implements Store {
  async get(_key: string): Promise<any> {
    return null;
  }

  async many(keys: string[]): Promise<Record<string, any>> {
    const result: Record<string, any> = {};
    for (const key of keys) {
      result[key] = null;
    }
    return result;
  }

  async put(_key: string, _value: any, _seconds: number): Promise<boolean> {
    return false;
  }

  async putMany(_values: Record<string, any>, _seconds: number): Promise<boolean> {
    return false;
  }

  async increment(_key: string, _value?: number): Promise<number | boolean> {
    return false;
  }

  async decrement(_key: string, _value?: number): Promise<number | boolean> {
    return false;
  }

  async forever(_key: string, _value: any): Promise<boolean> {
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
