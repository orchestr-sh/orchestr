/**
 * ConsoleKernel signature/output tests
 *
 * Exercises the new kernel surface end-to-end: signature-bound dispatch
 * (option precedence, array arguments), validation errors with usage text,
 * `list` / `help <command>` / `--help`, `--quiet`, `--no-interaction`, and
 * the `-v/-vv/-vvv` verbosity ladder.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command, CommandOptions } from '@/Console/Command';
import { ConsoleKernel } from '@/Console/ConsoleKernel';
import { Application } from '@/Foundation/Application';

class MakeModelCommand extends Command {
  signature = 'make:model {name} {--m|migration} {--f|factory} {--s|seed} {--p|pivot} {--all}';
  description = 'Create a new model';

  public received: { args: string[]; options: CommandOptions } | null = null;

  async handle(args: string[], options: CommandOptions): Promise<void> {
    this.received = { args, options };
    this.info(`Model created: ${this.argument('name')}`);
  }
}

class PublishCommand extends Command {
  signature = 'publish {--env=production} {--path=} {--tags*=}';
  description = 'Publish assets';

  public seenOptions: CommandOptions | null = null;

  async handle(_args: string[], options: CommandOptions): Promise<void> {
    this.seenOptions = options;
  }
}

class CollectCommand extends Command {
  signature = 'collect {names*}';
  description = 'Collect names';

  public names: string[] | null = null;

  async handle(_args: string[]): Promise<void> {
    this.names = this.argument('names') as string[];
  }
}

class AskCommand extends Command {
  signature = 'ask-it';
  description = 'Ask the user';

  public answer: boolean | string | null = null;

  async handle(): Promise<void> {
    this.answer = await this.confirm('Proceed?', true);
  }
}

class BoomCommand extends Command {
  signature = 'boom';
  description = 'Always fails';

  async handle(): Promise<void> {
    throw new Error('kaboom');
  }
}

function runKernel(kernel: ConsoleKernel, argv: string[]): Promise<void> {
  // vitest throws when a test triggers a real process.exit; the kernel
  // calls it after reporting, so mock it out in these dispatch tests.
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

  return kernel.run(['node', 'orchestr', ...argv]).finally(() => {
    exitSpy.mockRestore();
  });
}

describe('ConsoleKernel signature dispatch', () => {
  let app: Application;
  let kernel: ConsoleKernel;

  beforeEach(() => {
    app = new Application('/test');
    kernel = new ConsoleKernel(app);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('binds positional arguments and options through the signature', async () => {
    const command = new MakeModelCommand();
    kernel.register(command);

    await kernel.handle('make:model', ['Post'], { all: true });

    expect(command.received).not.toBeNull();
    expect(command.received!.args).toEqual(['Post']);
    expect(command.received!.options).toEqual({
      migration: false,
      factory: false,
      seed: false,
      pivot: false,
      all: true,
    });
  });

  it('normalises shortcuts before the command sees the options', async () => {
    const command = new MakeModelCommand();
    kernel.register(command);

    await runKernel(kernel, ['make:model', 'Post', '-m', '--all']);

    expect(command.received!.options).toEqual({
      migration: true,
      factory: false,
      seed: false,
      pivot: false,
      all: true,
    });
  });

  it('applies option precedence: provided values win over signature defaults', async () => {
    const command = new PublishCommand();
    kernel.register(command);

    await runKernel(kernel, ['publish', '--env=testing', '--tags=alpha', '--path']);

    // --path is bare, so it falls back to its declared (null) default;
    // --tags collects values; --env overrides the 'production' default;
    // undeclared options keep passing through untouched.
    expect(command.seenOptions).toEqual({ env: 'testing', path: null, tags: ['alpha'] });
  });

  it('collects array arguments', async () => {
    const command = new CollectCommand();
    kernel.register(command);

    await runKernel(kernel, ['collect', 'a', 'b', 'c']);

    expect(command.names).toEqual(['a', 'b', 'c']);
  });

  it('passes legacy-grammar commands through unchanged', async () => {
    class LegacyCommand extends Command {
      signature = 'make:controller <name> [--event=]';
      description = 'Legacy grammar';

      public seen: { args: string[]; options: CommandOptions } | null = null;

      async handle(args: string[], options: CommandOptions): Promise<void> {
        this.seen = { args, options };
      }
    }

    const command = new LegacyCommand();
    kernel.register(command);

    await runKernel(kernel, ['make:controller', 'UserController', '--event=Sync']);

    expect(command.seen).toEqual({ args: ['UserController'], options: { event: 'Sync' } });
  });
});

describe('ConsoleKernel validation output', () => {
  let app: Application;
  let kernel: ConsoleKernel;

  beforeEach(() => {
    app = new Application('/test');
    kernel = new ConsoleKernel(app);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports a missing required argument with the usage line', async () => {
    kernel.register(new MakeModelCommand());
    const logs: string[] = [];
    const errors: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => void logs.push(String(message)));
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((message?: unknown) => void errors.push(String(message)));

    await runKernel(kernel, ['make:model']);

    logSpy.mockRestore();
    errorSpy.mockRestore();

    expect(errors.join('\n')).toContain('Not enough arguments to "make:model" command (missing: "name").');
    expect(logs.join('\n')).toContain('Usage: make:model {name} {--m|migration}');
  });

  it('rejects unknown positional arguments', async () => {
    class Greet extends Command {
      signature = 'greet {name?}';
      description = 'Greet someone';
      async handle(): Promise<void> {
        // no-op
      }
    }

    kernel.register(new Greet());

    await expect(kernel.handle('greet', ['one', 'two'])).rejects.toThrow(/Too many arguments to "greet" command/);
  });

  it('rejects unknown commands with the legacy message', async () => {
    await expect(kernel.handle('nope:not-a-command')).rejects.toThrow('Command not found: nope:not-a-command');
  });
});

describe('ConsoleKernel list, help, and global flags', () => {
  let app: Application;
  let kernel: ConsoleKernel;

  beforeEach(() => {
    app = new Application('/test');
    kernel = new ConsoleKernel(app);
    kernel.registerMany([new MakeModelCommand(), new PublishCommand(), new CollectCommand()]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function capture(argv: string[]): Promise<{ logs: string[]; errors: string[] }> {
    const logs: string[] = [];
    const errors: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => void logs.push(String(message)));
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((message?: unknown) => void errors.push(String(message)));

    try {
      await runKernel(kernel, argv);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }

    return { logs, errors };
  }

  it('lists commands with descriptions through `orchestr list`', async () => {
    const { logs } = await capture(['list']);
    const output = logs.join('\n');

    expect(output).toContain('help');
    expect(output).toContain('list');
    expect(output).toContain('make:model');
    expect(output).toContain('Create a new model');
    expect(output).toContain('publish');
    expect(output).toContain('collect');
  });

  it('lists commands when invoked with no arguments', async () => {
    const { logs } = await capture([]);
    expect(logs.join('\n')).toContain('make:model');
  });

  it('shows command help through `help <command>`', async () => {
    const { logs } = await capture(['help', 'make:model']);
    const output = logs.join('\n');

    expect(output).toContain('Create a new model');
    expect(output).toContain('Usage: make:model {name} {--m|migration}');
    expect(output).toContain('-m, --migration');
    expect(output).toContain('--all');
    expect(output).toContain('--no-interaction');
  });

  it('shows value option defaults in help', async () => {
    const { logs } = await capture(['help', 'publish']);
    const output = logs.join('\n');

    expect(output).toContain('Usage: publish {--env=production}');
    expect(output).toContain('[default: production]');
  });

  it('shows help instead of executing when --help is given', async () => {
    const command = new MakeModelCommand();
    kernel.register(command);

    const { logs } = await capture(['make:model', 'Post', '--help']);

    expect(command.received).toBeNull();
    expect(logs.join('\n')).toContain('Usage: make:model {name}');
  });

  it('errors on help for an unknown command', async () => {
    const { errors } = await capture(['help', 'does:not-exist']);

    expect(errors.join('\n')).toContain('Command not found: does:not-exist');
  });

  it('--quiet silences normal output', async () => {
    const command = new MakeModelCommand();
    kernel.register(command);

    const { logs } = await capture(['make:model', 'Post', '--quiet']);

    expect(logs).toEqual([]);
    // The command still executed.
    expect(command.received).not.toBeNull();
  });

  it('treats prompts as defaulted when --no-interaction is passed', async () => {
    const command = new AskCommand();
    kernel.register(command);

    await capture(['ask-it', '--no-interaction']);

    expect(command.answer).toBe(true);
  });

  it('never hangs on prompts in non-interactive (non-TTY) output', async () => {
    const command = new AskCommand();
    kernel.register(command);

    // No flag: with a non-TTY stdin the kernel must mark the session
    // non-interactive and fall back to defaults. Pin the flag so the test
    // behaves identically when the suite runs inside an interactive
    // terminal where stdin would be a TTY.
    const originalStdinTty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    try {
      await capture(['ask-it']);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinTty, configurable: true });
    }

    expect(command.answer).toBe(true);
  });

  it('-vv adds the stack trace to reported errors, plain runs do not', async () => {
    kernel.register(new BoomCommand());

    const quiet = await capture(['boom']);
    expect(quiet.errors.join('\n')).toContain('kaboom');
    expect(quiet.logs.join('\n')).not.toContain('at ');

    const verbose = await capture(['boom', '-vv']);
    expect(verbose.errors.join('\n')).toContain('kaboom');
    expect(verbose.logs.join('\n')).toContain('at ');
  });

  it('sets verbosity on the command style from -vvv', async () => {
    let observed = -1;

    class ObserveCommand extends Command {
      signature = 'observe';
      description = 'Observe the style';
      async handle(): Promise<void> {
        observed = this.getStyle().getVerbosity();
      }
    }

    kernel.register(new ObserveCommand());
    await capture(['observe', '-vvv']);

    expect(observed).toBe(3);
  });
});
