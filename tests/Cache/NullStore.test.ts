import { describe, it, expect } from 'vitest';
import { NullStore } from '@/Cache/Stores/NullStore';

describe('NullStore', () => {
  const store = new NullStore();

  it('get() always returns null', async () => {
    expect(await store.get('any')).toBeNull();
  });

  it('many() returns all nulls', async () => {
    const result = await store.many(['a', 'b']);
    expect(result).toEqual({ a: null, b: null });
  });

  it('put() returns false', async () => {
    expect(await store.put('key', 'value', 3600)).toBe(false);
  });

  it('putMany() returns false', async () => {
    expect(await store.putMany({ a: 1 }, 3600)).toBe(false);
  });

  it('increment() returns false', async () => {
    expect(await store.increment('key', 1)).toBe(false);
  });

  it('decrement() returns false', async () => {
    expect(await store.decrement('key', 1)).toBe(false);
  });

  it('forever() returns false', async () => {
    expect(await store.forever('key', 'value')).toBe(false);
  });

  it('forget() returns true', async () => {
    expect(await store.forget('key')).toBe(true);
  });

  it('flush() returns true', async () => {
    expect(await store.flush()).toBe(true);
  });

  it('getPrefix() returns empty string', () => {
    expect(store.getPrefix()).toBe('');
  });
});
