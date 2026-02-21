"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const Command_1 = require("../../src/Console/Command");
const ConsoleKernel_1 = require("../../src/Console/ConsoleKernel");
const Application_1 = require("../../src/Foundation/Application");
class TestCommand extends Command_1.Command {
    signature = 'test:run {arg}';
    description = 'A test command';
    executed = false;
    receivedArgs = [];
    receivedOptions = {};
    async handle(args, options) {
        this.executed = true;
        this.receivedArgs = args;
        this.receivedOptions = options;
    }
}
class GreetCommand extends Command_1.Command {
    signature = 'greet {name}';
    description = 'Greet someone';
    async handle(args, options) {
        this.info(`Hello, ${args[0] || 'World'}!`);
    }
}
(0, vitest_1.describe)('Command', () => {
    (0, vitest_1.describe)('getName()', () => {
        (0, vitest_1.it)('extracts command name from signature', () => {
            const cmd = new TestCommand();
            (0, vitest_1.expect)(cmd.getName()).toBe('test:run');
        });
        (0, vitest_1.it)('handles simple signatures', () => {
            const cmd = new GreetCommand();
            (0, vitest_1.expect)(cmd.getName()).toBe('greet');
        });
    });
    (0, vitest_1.describe)('output methods', () => {
        (0, vitest_1.it)('info() writes green text', () => {
            const spy = vitest_1.vi.spyOn(console, 'log').mockImplementation(() => { });
            const cmd = new TestCommand();
            cmd['info']('test message');
            (0, vitest_1.expect)(spy).toHaveBeenCalledWith(vitest_1.expect.stringContaining('test message'));
            spy.mockRestore();
        });
        (0, vitest_1.it)('error() writes red text', () => {
            const spy = vitest_1.vi.spyOn(console, 'error').mockImplementation(() => { });
            const cmd = new TestCommand();
            cmd['error']('error message');
            (0, vitest_1.expect)(spy).toHaveBeenCalledWith(vitest_1.expect.stringContaining('error message'));
            spy.mockRestore();
        });
        (0, vitest_1.it)('warn() writes yellow text', () => {
            const spy = vitest_1.vi.spyOn(console, 'warn').mockImplementation(() => { });
            const cmd = new TestCommand();
            cmd['warn']('warning');
            (0, vitest_1.expect)(spy).toHaveBeenCalledWith(vitest_1.expect.stringContaining('warning'));
            spy.mockRestore();
        });
        (0, vitest_1.it)('line() writes plain text', () => {
            const spy = vitest_1.vi.spyOn(console, 'log').mockImplementation(() => { });
            const cmd = new TestCommand();
            cmd['line']('plain text');
            (0, vitest_1.expect)(spy).toHaveBeenCalledWith('plain text');
            spy.mockRestore();
        });
        (0, vitest_1.it)('newLine() writes empty lines', () => {
            const spy = vitest_1.vi.spyOn(console, 'log').mockImplementation(() => { });
            const cmd = new TestCommand();
            cmd['newLine'](2);
            (0, vitest_1.expect)(spy).toHaveBeenCalledTimes(2);
            spy.mockRestore();
        });
    });
});
(0, vitest_1.describe)('ConsoleKernel', () => {
    let app;
    let kernel;
    (0, vitest_1.beforeEach)(() => {
        app = new Application_1.Application('/test');
        kernel = new ConsoleKernel_1.ConsoleKernel(app);
    });
    (0, vitest_1.describe)('register()', () => {
        (0, vitest_1.it)('registers a command', () => {
            const cmd = new TestCommand();
            kernel.register(cmd);
            (0, vitest_1.expect)(kernel.getCommands().has('test:run')).toBe(true);
        });
    });
    (0, vitest_1.describe)('registerMany()', () => {
        (0, vitest_1.it)('registers multiple commands', () => {
            kernel.registerMany([new TestCommand(), new GreetCommand()]);
            (0, vitest_1.expect)(kernel.getCommands().size).toBe(2);
        });
    });
    (0, vitest_1.describe)('handle()', () => {
        (0, vitest_1.it)('executes a registered command', async () => {
            const cmd = new TestCommand();
            kernel.register(cmd);
            await kernel.handle('test:run', ['arg1'], { verbose: true });
            (0, vitest_1.expect)(cmd.executed).toBe(true);
            (0, vitest_1.expect)(cmd.receivedArgs).toEqual(['arg1']);
            (0, vitest_1.expect)(cmd.receivedOptions).toEqual({ verbose: true });
        });
        (0, vitest_1.it)('throws for unknown commands', async () => {
            await (0, vitest_1.expect)(kernel.handle('unknown')).rejects.toThrow('Command not found: unknown');
        });
    });
    (0, vitest_1.describe)('run()', () => {
        (0, vitest_1.it)('parses command name and arguments from argv', async () => {
            const cmd = new TestCommand();
            kernel.register(cmd);
            await kernel.run(['node', 'script.js', 'test:run', 'myarg']);
            (0, vitest_1.expect)(cmd.executed).toBe(true);
            (0, vitest_1.expect)(cmd.receivedArgs).toEqual(['myarg']);
        });
        (0, vitest_1.it)('parses --option=value flags', async () => {
            const cmd = new TestCommand();
            kernel.register(cmd);
            await kernel.run(['node', 'script.js', 'test:run', '--env=testing']);
            (0, vitest_1.expect)(cmd.receivedOptions).toEqual({ env: 'testing' });
        });
        (0, vitest_1.it)('parses --flag as boolean true', async () => {
            const cmd = new TestCommand();
            kernel.register(cmd);
            await kernel.run(['node', 'script.js', 'test:run', '--verbose']);
            (0, vitest_1.expect)(cmd.receivedOptions).toEqual({ verbose: true });
        });
        (0, vitest_1.it)('parses -shortflag as boolean true', async () => {
            const cmd = new TestCommand();
            kernel.register(cmd);
            await kernel.run(['node', 'script.js', 'test:run', '-v']);
            (0, vitest_1.expect)(cmd.receivedOptions).toEqual({ v: true });
        });
        (0, vitest_1.it)('lists commands when no args', async () => {
            const spy = vitest_1.vi.spyOn(console, 'log').mockImplementation(() => { });
            kernel.register(new TestCommand());
            await kernel.run(['node', 'script.js']);
            (0, vitest_1.expect)(spy).toHaveBeenCalled();
            spy.mockRestore();
        });
    });
    (0, vitest_1.describe)('getCommands()', () => {
        (0, vitest_1.it)('returns map of commands', () => {
            kernel.register(new TestCommand());
            const commands = kernel.getCommands();
            (0, vitest_1.expect)(commands).toBeInstanceOf(Map);
            (0, vitest_1.expect)(commands.size).toBe(1);
        });
    });
    (0, vitest_1.describe)('getApplication()', () => {
        (0, vitest_1.it)('returns the application instance', () => {
            (0, vitest_1.expect)(kernel.getApplication()).toBe(app);
        });
    });
});
//# sourceMappingURL=Console.test.js.map