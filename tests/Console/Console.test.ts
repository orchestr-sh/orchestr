import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command, CommandOptions } from '@/Console/Command';
import { ConsoleKernel } from '@/Console/ConsoleKernel';
import { Application } from '@/Foundation/Application';

class TestCommand extends Command {
  signature = 'test:run {arg}';
  description = 'A test command';
  public executed = false;
  public receivedArgs: string[] = [];
  public receivedOptions: CommandOptions = {};

  async handle(args: string[], options: CommandOptions): Promise<void> {
    this.executed = true;
    this.receivedArgs = args;
    this.receivedOptions = options;
  }
}

class GreetCommand extends Command {
  signature = 'greet {name}';
  description = 'Greet someone';

  async handle(args: string[], options: CommandOptions): Promise<void> {
    this.info(`Hello, ${args[0] || 'World'}!`);
  }
}

describe('Command', () => {
  describe('getName()', () => {
    it('extracts command name from signature', () => {
      const cmd = new TestCommand();
      expect(cmd.getName()).toBe('test:run');
    });

    it('handles simple signatures', () => {
      const cmd = new GreetCommand();
      expect(cmd.getName()).toBe('greet');
    });
  });

  describe('output methods', () => {
    it('info() writes green text', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const cmd = new TestCommand();
      cmd['info']('test message');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('test message'));
      spy.mockRestore();
    });

    it('error() writes red text', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cmd = new TestCommand();
      cmd['error']('error message');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('error message'));
      spy.mockRestore();
    });

    it('warn() writes yellow text', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const cmd = new TestCommand();
      cmd['warn']('warning');
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('warning'));
      spy.mockRestore();
    });

    it('line() writes plain text', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const cmd = new TestCommand();
      cmd['line']('plain text');
      expect(spy).toHaveBeenCalledWith('plain text');
      spy.mockRestore();
    });

    it('newLine() writes empty lines', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const cmd = new TestCommand();
      cmd['newLine'](2);
      expect(spy).toHaveBeenCalledTimes(2);
      spy.mockRestore();
    });
  });
});

describe('ConsoleKernel', () => {
  let app: Application;
  let kernel: ConsoleKernel;

  beforeEach(() => {
    app = new Application('/test');
    kernel = new ConsoleKernel(app);
  });

  describe('register()', () => {
    it('registers a command', () => {
      const cmd = new TestCommand();
      kernel.register(cmd);
      expect(kernel.getCommands().has('test:run')).toBe(true);
    });
  });

  describe('registerMany()', () => {
    it('registers multiple commands', () => {
      kernel.registerMany([new TestCommand(), new GreetCommand()]);
      expect(kernel.getCommands().size).toBe(2);
    });
  });

  describe('handle()', () => {
    it('executes a registered command', async () => {
      const cmd = new TestCommand();
      kernel.register(cmd);
      await kernel.handle('test:run', ['arg1'], { verbose: true });
      expect(cmd.executed).toBe(true);
      expect(cmd.receivedArgs).toEqual(['arg1']);
      expect(cmd.receivedOptions).toEqual({ verbose: true });
    });

    it('throws for unknown commands', async () => {
      await expect(kernel.handle('unknown')).rejects.toThrow('Command not found: unknown');
    });
  });

  describe('run()', () => {
    it('parses command name and arguments from argv', async () => {
      const cmd = new TestCommand();
      kernel.register(cmd);
      await kernel.run(['node', 'script.js', 'test:run', 'myarg']);
      expect(cmd.executed).toBe(true);
      expect(cmd.receivedArgs).toEqual(['myarg']);
    });

    it('parses --option=value flags', async () => {
      const cmd = new TestCommand();
      kernel.register(cmd);
      await kernel.run(['node', 'script.js', 'test:run', '--env=testing']);
      expect(cmd.receivedOptions).toEqual({ env: 'testing' });
    });

    it('parses --flag as boolean true', async () => {
      const cmd = new TestCommand();
      kernel.register(cmd);
      await kernel.run(['node', 'script.js', 'test:run', '--verbose']);
      expect(cmd.receivedOptions).toEqual({ verbose: true });
    });

    it('parses -shortflag as boolean true', async () => {
      const cmd = new TestCommand();
      kernel.register(cmd);
      await kernel.run(['node', 'script.js', 'test:run', '-v']);
      expect(cmd.receivedOptions).toEqual({ v: true });
    });

    it('lists commands when no args', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      kernel.register(new TestCommand());
      await kernel.run(['node', 'script.js']);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('getCommands()', () => {
    it('returns map of commands', () => {
      kernel.register(new TestCommand());
      const commands = kernel.getCommands();
      expect(commands).toBeInstanceOf(Map);
      expect(commands.size).toBe(1);
    });
  });

  describe('getApplication()', () => {
    it('returns the application instance', () => {
      expect(kernel.getApplication()).toBe(app);
    });
  });
});
