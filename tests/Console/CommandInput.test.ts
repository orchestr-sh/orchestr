/**
 * CommandInput tests
 *
 * Covers binding raw argv tokens onto a parsed signature: positional
 * resolution, array collection, defaults, shortcut normalisation, option
 * precedence, pass-through of undeclared options, and validation errors.
 */

import { describe, it, expect } from 'vitest';
import { CommandInput, ConsoleInputError } from '@/Console/Input/CommandInput';
import { CommandSignature } from '@/Console/Input/CommandSignature';

function inputFor(signature: string, positional: string[] = [], options: Record<string, unknown> = {}): CommandInput {
  return new CommandInput(CommandSignature.parse(signature), positional, options);
}

describe('CommandInput', () => {
  describe('argument binding', () => {
    it('binds positional values to named arguments in order', () => {
      const input = inputFor('send {to} {from?}', ['ada@example.com']);

      expect(input.getArgument('to')).toBe('ada@example.com');
      expect(input.getArgument('from')).toBeNull();
      expect(input.getArguments()).toEqual({ to: 'ada@example.com', from: null });
    });

    it('applies declared defaults when a value is missing', () => {
      const input = inputFor('greet {name=World}');

      expect(input.getArgument('name')).toBe('World');
      expect(input.getArgumentsPositional()).toEqual(['World']);
    });

    it('collects all remaining tokens into array arguments', () => {
      const input = inputFor('pick {names*}', ['a', 'b', 'c']);

      expect(input.getArgument('names')).toEqual(['a', 'b', 'c']);
      expect(input.getArgumentsPositional()).toEqual(['a', 'b', 'c']);
    });

    it('yields an empty array argument when nothing was given', () => {
      const input = inputFor('pick {names*}');

      expect(input.getArgument('names')).toEqual([]);
      input.validate();
    });

    it('supports a leading scalar argument followed by an array argument', () => {
      const input = inputFor('cmd {first} {rest*}', ['one', 'two', 'three']);

      expect(input.getArgument('first')).toBe('one');
      expect(input.getArgument('rest')).toEqual(['two', 'three']);
    });

    it('throws for arguments the signature does not declare', () => {
      const input = inputFor('greet {name}', ['World']);

      expect(() => input.getArgument('missing')).toThrow(/does not exist/);
    });

    it('reports declared arguments via hasArgument', () => {
      const input = inputFor('greet {name}');

      expect(input.hasArgument('name')).toBe(true);
      expect(input.hasArgument('other')).toBe(false);
    });
  });

  describe('option binding and precedence', () => {
    it('applies declared option defaults', () => {
      const input = inputFor('cmd {--env=production} {--force}');

      expect(input.getOption('env')).toBe('production');
      expect(input.getOption('force')).toBe(false);
      expect(input.getOptions()).toEqual({ env: 'production', force: false });
    });

    it('lets provided values win over defaults', () => {
      const input = inputFor('cmd {--env=production}', [], { env: 'testing' });

      expect(input.getOption('env')).toBe('testing');
    });

    it('normalises shortcuts to the canonical long name', () => {
      const input = inputFor('make:model {name} {--m|migration}', ['Post'], { m: true });

      expect(input.getOption('migration')).toBe(true);
      expect(input.getOptions()).toEqual({ migration: true });
      expect(input.getOptions()).not.toHaveProperty('m');
    });

    it('treats a bare value option as its declared default', () => {
      const defaulted = inputFor('cmd {--env=production}', [], { env: true });
      expect(defaulted.getOption('env')).toBe('production');

      const nullable = inputFor('cmd {--path=}', [], { path: true });
      expect(nullable.getOption('path')).toBeNull();
    });

    it('wraps array option values into lists', () => {
      const input = inputFor('cmd {--tags*=}', [], { tags: 'alpha' });
      expect(input.getOption('tags')).toEqual(['alpha']);

      const bare = inputFor('cmd {--tags*=}', [], { tags: true });
      expect(bare.getOption('tags')).toEqual([]);

      const listed = inputFor('cmd {--tags*=}', [], { tags: ['a', 'b'] });
      expect(listed.getOption('tags')).toEqual(['a', 'b']);
    });

    it('passes options the signature does not declare through untouched', () => {
      const input = inputFor('migrate', [], { path: '/somewhere', seed: true });

      expect(input.getOptions()).toEqual({ path: '/somewhere', seed: true });
    });

    it('supports setOption for post-binding adjustments', () => {
      const input = inputFor('cmd {--env=production}');
      input.setOption('env', 'staging');

      expect(input.getOption('env')).toBe('staging');

      input.setOption('custom', 'value');
      expect(input.getOptions().custom).toBe('value');
    });
  });

  describe('validation', () => {
    it('passes for valid input', () => {
      expect(() => inputFor('make:model {name}', ['Post']).validate()).not.toThrow();
    });

    it('rejects missing required arguments with the usage line', () => {
      let error: ConsoleInputError | undefined;

      try {
        inputFor('make:model {name} {--all}').validate();
      } catch (caught) {
        error = caught as ConsoleInputError;
      }

      expect(error).toBeInstanceOf(ConsoleInputError);
      expect(error!.message).toBe('Not enough arguments to "make:model" command (missing: "name").');
      expect(error!.usage).toBe('make:model {name} {--all}');
    });

    it('lists every missing argument', () => {
      expect(() => inputFor('cmd {one} {two}').validate()).toThrow(/missing: "one", "two"/);
    });

    it('rejects unknown positional arguments with the usage line', () => {
      let error: ConsoleInputError | undefined;

      try {
        inputFor('greet {name}', ['World', 'extra', 'tokens']).validate();
      } catch (caught) {
        error = caught as ConsoleInputError;
      }

      expect(error).toBeInstanceOf(ConsoleInputError);
      expect(error!.message).toContain('Too many arguments to "greet" command');
      expect(error!.message).toContain('expected arguments "name"');
      expect(error!.usage).toBe('greet {name}');
    });

    it('reports commands that accept no arguments', () => {
      expect(() => inputFor('migrate', ['stray']).validate()).toThrow(/does not accept arguments/);
    });

    it('accepts extra tokens when the signature declares an array argument', () => {
      expect(() => inputFor('pick {names*}', ['a', 'b']).validate()).not.toThrow();
    });
  });

  describe('legacy grammar', () => {
    it('binds <name> as required and validates its absence', () => {
      const ok = inputFor('make:controller <name>', ['UserController']);
      ok.validate();
      expect(ok.getArgument('name')).toBe('UserController');

      expect(() => inputFor('make:controller <name>').validate()).toThrow(/missing: "name"/);
    });

    it('binds optional [connection] arguments', () => {
      const input = inputFor('queue:work [connection]');
      input.validate();

      expect(input.getArgument('connection')).toBeNull();
      expect(input.getArgumentsPositional()).toEqual([]);
    });

    it('merges legacy [--opt=] defaults and [--flag] booleans', () => {
      const input = inputFor('deploy:init [--name=] [--yes]', [], { name: 'api', yes: true });

      expect(input.getOptions()).toEqual({ name: 'api', yes: true });
    });
  });

  it('exposes the parsed definition', () => {
    const input = inputFor('make:model {name}');

    expect(input.getDefinition().name).toBe('make:model');
  });
});
