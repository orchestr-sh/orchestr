import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Env } from '@/Foundation/Env/Env';
import { env } from '@/Support/helpers';

const managedKeys = [
  'DB_HOST',
  'APP_NAME',
  'FLAG_ON',
  'FLAG_OFF',
  'NULLISH',
  'EMPTYISH',
  'PRESET',
  'OVERRIDE_ME',
  'DUPLICATE',
  'LATER',
];

describe('Env', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'orchestr-env-'));
  });

  afterEach(() => {
    for (const key of managedKeys) {
      Env.forget(key);
    }

    vi.restoreAllMocks();
    rmSync(workspace, { recursive: true, force: true });
  });

  function writeEnvFile(name: string, contents: string): string {
    const path = join(workspace, name);
    writeFileSync(path, contents, 'utf-8');

    return path;
  }

  describe('load()', () => {
    it('loads variables into the process environment', () => {
      const applied = Env.load(writeEnvFile('.env', 'DB_HOST=127.0.0.1\nAPP_NAME=My App\n'));

      expect(applied).toEqual({ DB_HOST: '127.0.0.1', APP_NAME: 'My App' });
      expect(process.env.DB_HOST).toBe('127.0.0.1');
    });

    it('is a no-op for missing files', () => {
      expect(Env.load(join(workspace, '.env'))).toEqual({});
    });

    it('does not overwrite existing process environment variables by default', () => {
      // Simulate a variable set by the host (not by a .env file).
      process.env.PRESET = 'from-process';

      const applied = Env.load(writeEnvFile('.env', 'PRESET=from-file\nLATER=new-value\n'));

      expect(process.env.PRESET).toBe('from-process');
      expect(applied).toEqual({ LATER: 'new-value' });
      expect(Env.get('PRESET')).toBe('from-process');
    });

    it('lets a later file replace values that a previous file loaded', () => {
      Env.load(writeEnvFile('.env', 'APP_NAME=base\n'));
      Env.load(writeEnvFile('.env.production', 'APP_NAME=production-name\n'));

      expect(Env.get('APP_NAME')).toBe('production-name');
    });

    it('never lets a later file replace host environment variables', () => {
      process.env.PRESET = 'from-process';

      Env.load(writeEnvFile('.env', 'PRESET=from-file\n'));
      Env.load(writeEnvFile('.env.production', 'PRESET=from-specific-file\n'));

      expect(process.env.PRESET).toBe('from-process');
    });

    it('replaces existing variables when overwrite is requested', () => {
      process.env.OVERRIDE_ME = 'real-value';

      Env.load(writeEnvFile('.env', 'OVERRIDE_ME=from-file\n'), true);

      expect(process.env.OVERRIDE_ME).toBe('from-file');
    });

    it('keeps the last value for duplicate keys inside one file', () => {
      Env.load(writeEnvFile('.env', 'DUPLICATE=one\nDUPLICATE=two\n'));

      expect(process.env.DUPLICATE).toBe('two');
    });
  });

  describe('get() coercion', () => {
    beforeEach(() => {
      Env.load(
        writeEnvFile(
          '.env',
          ['FLAG_ON=true', 'FLAG_OFF=FALSE', 'NULLISH=null', 'EMPTYISH=(empty)', 'DB_HOST=127.0.0.1'].join('\n')
        )
      );
    });

    it('coerces true/false/null/empty the way Laravel env() does', () => {
      expect(Env.get('FLAG_ON')).toBe(true);
      expect(Env.get('FLAG_OFF')).toBe(false);
      expect(Env.get('NULLISH')).toBeNull();
      expect(Env.get('EMPTYISH')).toBe('');
    });

    it('leaves ordinary strings untouched', () => {
      expect(Env.get('DB_HOST')).toBe('127.0.0.1');
    });

    it('returns the default value for missing keys', () => {
      expect(Env.get('NO_SUCH_KEY_AT_ALL')).toBeUndefined();
      expect(Env.get('NO_SUCH_KEY_AT_ALL', 'fallback')).toBe('fallback');
    });

    it('has() reports defined variables', () => {
      expect(Env.has('DB_HOST')).toBe(true);
      expect(Env.has('NO_SUCH_KEY_AT_ALL')).toBe(false);
    });
  });

  describe('set()/forget()', () => {
    it('round-trips booleans and null through get()', () => {
      Env.set('FLAG_ON', true);
      expect(Env.get('FLAG_ON')).toBe(true);

      Env.set('FLAG_OFF', false);
      expect(Env.get('FLAG_OFF')).toBe(false);

      Env.set('NULLISH', null);
      expect(Env.get('NULLISH')).toBeNull();
    });

    it('stores plain values as strings', () => {
      Env.set('DB_HOST', '10.0.0.1');
      expect(process.env.DB_HOST).toBe('10.0.0.1');
    });

    it('removes the variable when set to undefined and via forget()', () => {
      Env.set('LATER', 'value');
      Env.set('LATER', undefined);
      expect(Env.has('LATER')).toBe(false);

      Env.set('LATER', 'value');
      Env.forget('LATER');
      expect(Env.has('LATER')).toBe(false);
    });
  });

  describe('env() helper', () => {
    it('delegates to the Env repository with coercion', () => {
      const spy = vi.spyOn(Env, 'get');

      Env.load(writeEnvFile('.env', 'FLAG_ON=true\nDB_HOST=localhost'));

      expect(env('FLAG_ON')).toBe(true);
      expect(env('DB_HOST')).toBe('localhost');
      expect(spy).toHaveBeenCalledWith('DB_HOST', null);
    });

    it('defaults to null for missing variables, like Laravel', () => {
      expect(env('NO_SUCH_KEY_AT_ALL')).toBeNull();
      expect(env('NO_SUCH_KEY_AT_ALL', 'http://localhost')).toBe('http://localhost');
    });
  });

  it('parse() exposes the raw parser without touching the environment', () => {
    expect(Env.parse('KEY="value # not comment"')).toEqual({ KEY: 'value # not comment' });
    expect(Env.has('KEY')).toBe(false);
  });
});
