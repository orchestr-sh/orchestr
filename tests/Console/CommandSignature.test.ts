/**
 * CommandSignature parser tests
 *
 * Covers the Laravel-style signature grammar (arguments, array arguments,
 * defaults, option shortcuts, value options, boolean flags, descriptions),
 * the legacy `<name>` / `[--opt=]` grammar used by the built-in commands,
 * and invalid signature errors.
 */

import { describe, it, expect } from 'vitest';
import { CommandSignature, InvalidSignatureError } from '@/Console/Input/CommandSignature';

describe('CommandSignature.parse', () => {
  describe('the make:model grammar from the ticket', () => {
    const parsed = CommandSignature.parse(
      'make:model {name} {--m|migration} {--f|factory} {--s|seed} {--p|pivot} {--all}'
    );

    it('extracts the command name', () => {
      expect(parsed.name).toBe('make:model');
    });

    it('parses the required argument', () => {
      expect(parsed.arguments).toEqual([
        { name: 'name', required: true, isArray: false, default: null, description: '' },
      ]);
    });

    it('parses options with shortcuts and the boolean flag', () => {
      expect(parsed.options).toEqual([
        { name: 'migration', shortcut: 'm', requiresValue: false, isArray: false, default: false, description: '' },
        { name: 'factory', shortcut: 'f', requiresValue: false, isArray: false, default: false, description: '' },
        { name: 'seed', shortcut: 's', requiresValue: false, isArray: false, default: false, description: '' },
        { name: 'pivot', shortcut: 'p', requiresValue: false, isArray: false, default: false, description: '' },
        { name: 'all', requiresValue: false, isArray: false, default: false, description: '' },
      ]);
    });

    it('keeps a canonical usage string', () => {
      expect(parsed.usage).toBe('make:model {name} {--m|migration} {--f|factory} {--s|seed} {--p|pivot} {--all}');
    });
  });

  it('parses required, optional, and defaulted arguments', () => {
    const parsed = CommandSignature.parse('greet {name} {title?} {locale=en}');

    expect(parsed.arguments[0]).toMatchObject({ name: 'name', required: true, default: null });
    expect(parsed.arguments[1]).toMatchObject({ name: 'title', required: false, default: null });
    expect(parsed.arguments[2]).toMatchObject({ name: 'locale', required: false, default: 'en' });
  });

  it('parses array arguments and treats them as not required', () => {
    const plain = CommandSignature.parse('collect {names*}');
    expect(plain.arguments[0]).toMatchObject({ name: 'names', required: false, isArray: true, default: null });

    const defaulted = CommandSignature.parse('collect {names*=alpha,beta}');
    expect(defaulted.arguments[0]).toMatchObject({ isArray: true, default: ['alpha', 'beta'] });
  });

  it('parses value options, defaults, and descriptions', () => {
    const parsed = CommandSignature.parse('publish {--path=} {--format=json} {--env= : The application environment}');

    expect(parsed.options[0]).toMatchObject({ name: 'path', requiresValue: true, default: null });
    expect(parsed.options[1]).toMatchObject({ name: 'format', requiresValue: true, default: 'json' });
    expect(parsed.options[2]).toMatchObject({
      name: 'env',
      requiresValue: true,
      default: null,
      description: 'The application environment',
    });
  });

  it('strips quotes around descriptions and tolerates spaces inside', () => {
    const parsed = CommandSignature.parse('seed {class? : "The class to seed"}');
    expect(parsed.arguments[0]).toMatchObject({ name: 'class', description: 'The class to seed' });
  });

  it('normalises shortcut and long name regardless of order', () => {
    const shortcutFirst = CommandSignature.parse('x {--f|force}');
    expect(shortcutFirst.options[0]).toMatchObject({ name: 'force', shortcut: 'f' });

    const nameFirst = CommandSignature.parse('x {--force|f}');
    expect(nameFirst.options[0]).toMatchObject({ name: 'force', shortcut: 'f' });
  });

  it('parses array options as value-taking lists', () => {
    const parsed = CommandSignature.parse('x {--tags*=}');
    expect(parsed.options[0]).toMatchObject({ name: 'tags', requiresValue: true, isArray: true, default: [] });
  });

  describe('legacy grammar used by built-in commands', () => {
    it('parses <name> as a required argument', () => {
      const parsed = CommandSignature.parse('make:controller <name>');
      expect(parsed.arguments[0]).toMatchObject({ name: 'name', required: true });
    });

    it('parses [name] as an optional argument', () => {
      const parsed = CommandSignature.parse('queue:work [connection]');
      expect(parsed.arguments[0]).toMatchObject({ name: 'connection', required: false, default: null });
    });

    it('parses [--opt=] and [--flag] options', () => {
      const parsed = CommandSignature.parse('deploy:init [--name=] [--repository=] [--yes]');
      expect(parsed.options[0]).toMatchObject({ name: 'name', requiresValue: true, default: null });
      expect(parsed.options[1]).toMatchObject({ name: 'repository', requiresValue: true, default: null });
      expect(parsed.options[2]).toMatchObject({ name: 'yes', requiresValue: false, default: false });
    });

    it('parses [--timezone=TIMEZONE] defaults', () => {
      const parsed = CommandSignature.parse('schedule:list [--timezone=TIMEZONE]');
      expect(parsed.options[0]).toMatchObject({ name: 'timezone', requiresValue: true, default: 'TIMEZONE' });
    });

    it('parses signatures with mixed argument and option tokens', () => {
      const parsed = CommandSignature.parse('make:listener <name> [--event=] [--queued]');
      expect(parsed.arguments).toHaveLength(1);
      expect(parsed.options).toHaveLength(2);
    });
  });

  describe('invalid signatures', () => {
    it('rejects tokens that are not bracketed parameters', () => {
      expect(() => CommandSignature.parse('make:model name')).toThrow(InvalidSignatureError);
      expect(() => CommandSignature.parse('make:model name')).toThrow(/Unexpected token "name"/);
    });

    it('rejects signatures that start with a parameter token', () => {
      expect(() => CommandSignature.parse('{name} make:model')).toThrow(/command name must come before/);
    });

    it('rejects unbalanced tokens', () => {
      expect(() => CommandSignature.parse('make:model {name')).toThrow(/Unbalanced token/);
    });

    it('rejects empty names', () => {
      expect(() => CommandSignature.parse('make:model {}')).toThrow(InvalidSignatureError);
      expect(() => CommandSignature.parse('make:model {--}')).toThrow(InvalidSignatureError);
    });

    it('rejects more than one shortcut separator', () => {
      expect(() => CommandSignature.parse('x {--a|b|c}')).toThrow(/Invalid shortcut token/);
    });

    it('rejects an empty signature', () => {
      expect(() => CommandSignature.parse('')).toThrow(InvalidSignatureError);
    });
  });

  it('memoizes parses per signature string', () => {
    expect(CommandSignature.parse('a {b}')).toBe(CommandSignature.parse('a {b}'));
  });

  it('renders the usage string via the static helper', () => {
    expect(CommandSignature.usage('make:model {name} {--all}')).toBe('make:model {name} {--all}');
  });
});
