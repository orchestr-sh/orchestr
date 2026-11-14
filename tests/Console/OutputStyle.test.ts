/**
 * OutputStyle tests
 *
 * Covers ANSI decoration detection (NO_COLOR / FORCE_COLOR / non-TTY
 * fallbacks), the styled writers and their channels, quiet mode, table and
 * progress rendering, spin, and the prompt helpers — including the
 * non-interactive fallbacks that must never hang.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { OutputStyleOptions } from '@/Console/Output/OutputStyle';
import { AnsiColor } from '@/Console/Output/AnsiColor';
import { OutputStyle } from '@/Console/Output/OutputStyle';

/** Shared readline mock: queues canned answers, fires `close` on EOF. */
const rl = vi.hoisted(() => ({
  answers: [] as string[],
  prompts: [] as { text: string; terminal?: boolean }[],
}));

vi.mock('node:readline', () => ({
  createInterface: (options: { terminal?: boolean }) => {
    const closeListeners: Array<() => void> = [];

    return {
      question: (text: string, callback: (answer: string) => void) => {
        rl.prompts.push({ text, ...(options.terminal === false ? { terminal: false } : {}) });

        queueMicrotask(() => {
          if (rl.answers.length > 0) {
            callback(rl.answers.shift() as string);
          } else {
            // EOF: stdin closed without an answer.
            closeListeners.forEach((notify) => notify());
          }
        });
      },
      close: () => undefined,
      on: (event: string, listener: () => void) => {
        if (event === 'close') {
          closeListeners.push(listener);
        }
      },
    };
  },
}));

function captureStyle(options: Omit<OutputStyleOptions, 'writer'> = {}) {
  const lines: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const raw: string[] = [];

  const style = new OutputStyle({
    decorated: false,
    interactive: false,
    overwrite: false,
    ...options,
    writer: {
      log: (message: string) => void lines.push(message),
      warn: (message: string) => void warnings.push(message),
      error: (message: string) => void errors.push(message),
      write: (chunk: string) => void raw.push(chunk),
    },
  });

  return { style, lines, warnings, errors, raw };
}

describe('AnsiColor.detect', () => {
  it('honours NO_COLOR even on a TTY with FORCE_COLOR set', () => {
    expect(AnsiColor.detect({ NO_COLOR: '1' }, true)).toBe(false);
    expect(AnsiColor.detect({ NO_COLOR: '1', FORCE_COLOR: '1' }, true)).toBe(false);
  });

  it('honours FORCE_COLOR off a TTY', () => {
    expect(AnsiColor.detect({ FORCE_COLOR: '1' }, false)).toBe(true);
  });

  it('ignores empty NO_COLOR and zero FORCE_COLOR', () => {
    expect(AnsiColor.detect({ NO_COLOR: '', FORCE_COLOR: '1' }, false)).toBe(true);
    expect(AnsiColor.detect({ FORCE_COLOR: '0' }, false)).toBe(false);
  });

  it('falls back to the TTY flag', () => {
    expect(AnsiColor.detect({}, true)).toBe(true);
    expect(AnsiColor.detect({}, false)).toBe(false);
  });
});

describe('AnsiColor.apply', () => {
  it('wraps styled text with ANSI escapes when decorated', () => {
    expect(AnsiColor.apply('info', 'hello', true)).toBe('\x1b[32mhello\x1b[0m');
    expect(AnsiColor.apply('success', 'done', true)).toBe('\x1b[1;32mdone\x1b[0m');
  });

  it('returns plain text when not decorated', () => {
    expect(AnsiColor.apply('error', 'boom', false)).toBe('boom');
  });

  it('strips escapes back to plain text', () => {
    expect(AnsiColor.strip('\x1b[31mred\x1b[0m')).toBe('red');
  });
});

describe('OutputStyle decoration', () => {
  it('colours styles when decorated', () => {
    const { style, lines } = captureStyle({ decorated: true });

    style.info('green');
    style.comment('gray');

    expect(lines[0]).toBe('\x1b[32mgreen\x1b[0m');
    expect(lines[1]).toBe('\x1b[90mgray\x1b[0m');
  });

  it('writes plain text on non-TTY output', () => {
    const { style, lines, errors } = captureStyle({ decorated: false });

    style.info('green');
    style.error('boom');

    expect(lines).toEqual(['green']);
    expect(errors).toEqual(['boom']);
  });

  it('keeps line() plain even when decorated', () => {
    const { style, lines } = captureStyle({ decorated: true });

    style.line('plain');
    expect(lines).toEqual(['plain']);
  });

  it('auto-detects decoration from NO_COLOR', () => {
    vi.stubEnv('NO_COLOR', '1');

    try {
      const style = new OutputStyle();
      expect(style.isDecorated()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('OutputStyle channels', () => {
  it('routes info/success/comment/question to stdout and warning/error to the warn/error channels', () => {
    const { style, lines, warnings, errors } = captureStyle();

    style.info('i');
    style.success('s');
    style.comment('c');
    style.question('q');
    style.line('l');
    style.newLine(2);
    style.warning('w');
    style.error('e');

    expect(lines).toEqual(['i', 's', 'c', 'q', 'l', '', '']);
    expect(warnings).toEqual(['w']);
    expect(errors).toEqual(['e']);
  });

  it('silences every write in quiet mode', () => {
    const { style, lines, warnings, errors } = captureStyle({ quiet: true });

    style.info('i');
    style.warning('w');
    style.error('e');
    style.table(['h'], [['r']]);

    expect(lines).toEqual([]);
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('tracks verbosity, quiet, decoration, and interactivity flags', () => {
    const { style } = captureStyle();

    expect(style.getVerbosity()).toBe(1);
    style.setVerbosity(3);
    expect(style.isDebug()).toBe(true);
    expect(style.isVerbose()).toBe(true);

    style.setQuiet();
    expect(style.isQuiet()).toBe(true);
    expect(style.isVerbose()).toBe(false);

    style.setQuiet(false);
    style.setInteractive(true);
    expect(style.isInteractive()).toBe(true);
    style.setDecorated(true);
    expect(style.isDecorated()).toBe(true);
  });
});

describe('OutputStyle.table', () => {
  it('renders a padded bordered grid', () => {
    const { style, lines } = captureStyle();

    style.table(
      ['Name', 'Score'],
      [
        ['ada', 100],
        ['grace', 99],
      ]
    );

    const output = lines.join('\n');
    expect(output).toContain('+-------+-------+');
    expect(output).toContain('| Name  | Score |');
    expect(output).toContain('| ada   | 100   |');
    expect(output).toContain('| grace | 99    |');
  });

  it('tolerates ragged rows and empty tables', () => {
    const { style, lines } = captureStyle();

    expect(() => style.table(['A', 'B'], [['only-one']])).not.toThrow();
    const output = lines.join('\n');
    expect(output).toContain('| A ');
    expect(output).toContain('B |');
    expect(output).toContain('| only-one |   |');

    expect(() => style.table([], [])).not.toThrow();
  });
});

describe('OutputStyle.progress', () => {
  it('emits a bar line per update when output cannot overwrite', () => {
    const { style, lines } = captureStyle();

    style.progress(10, 0);
    style.progress(10, 5);
    style.progress(10, 10);

    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('50%');
    expect(lines[1]).toContain('5/10');
    expect(lines[2]).toContain('100%');
  });

  it('overwrites in place on TTY-like output and closes with a newline', () => {
    const { style, raw, lines } = captureStyle({ overwrite: true });

    style.progress(2, 2);

    expect(lines).toEqual([]);
    expect(raw.join('')).toContain('\r');
    expect(raw[raw.length - 1]).toBe('\n');
  });

  it('is silent in quiet mode', () => {
    const { style, lines } = captureStyle({ quiet: true });

    style.progress(10, 5);
    expect(lines).toEqual([]);
  });
});

describe('OutputStyle.spin', () => {
  it('runs the callback and returns its result without hanging off-TTY', async () => {
    const { style, lines } = captureStyle();

    const result = await style.spin('Working', () => 'value');

    expect(result).toBe('value');
    expect(lines).toEqual([]);
  });

  it('clears its animation interval when the callback finishes', async () => {
    const { style, raw } = captureStyle({ overwrite: true });

    await style.spin('Deploying', async () => 42);

    // Every emitted chunk is a carriage-return redraw (first frame + clear);
    // the interval is cleared so nothing keeps spinning after completion.
    expect(raw.length).toBeGreaterThanOrEqual(2);
    expect(raw.every((chunk) => chunk.startsWith('\r'))).toBe(true);
    expect(raw[raw.length - 1]).toBe(`\r${' '.repeat('Deploying'.length + 2)}\r`);
  });

  it('propagates callback failures after cleanup', async () => {
    const { style } = captureStyle({ overwrite: true });

    await expect(
      style.spin('Failing', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });

  it('prints a single spinner line without a callback', async () => {
    const { style, lines } = captureStyle();

    await style.spin('Processing');

    expect(lines[0]).toContain('Processing');
  });
});

describe('OutputStyle prompts (non-interactive)', () => {
  it('resolves every prompt to its default without touching stdin', async () => {
    const { style } = captureStyle({ interactive: false });

    await expect(style.ask('Name?', 'anonymous')).resolves.toBe('anonymous');
    await expect(style.secret('Token?', 'fallback-token')).resolves.toBe('fallback-token');
    await expect(style.confirm('Proceed?', true)).resolves.toBe(true);
    await expect(style.confirm('Proceed?')).resolves.toBe(false);
    await expect(style.choice('Pick', ['a', 'b'], 'b')).resolves.toBe('b');
    await expect(style.anticipate('City?', ['Paris', 'Lyon'], 'Paris')).resolves.toBe('Paris');

    expect(rl.prompts).toEqual([]);
  });

  it('resolves a numeric choice fallback by index', async () => {
    const { style } = captureStyle();

    await expect(style.choice('Pick', ['first', 'second'], 1)).resolves.toBe('second');
  });

  it('defaults to the first choice when no fallback is given', async () => {
    const { style } = captureStyle();

    await expect(style.choice('Pick', ['solo', 'other'])).resolves.toBe('solo');
  });

  it('is non-interactive when quiet even with the interactive flag set', async () => {
    const { style } = captureStyle({ interactive: true, quiet: true });

    await expect(style.confirm('Proceed?', true)).resolves.toBe(true);
    expect(rl.prompts).toEqual([]);
  });
});

describe('OutputStyle prompts (interactive, mocked readline)', () => {
  beforeEach(() => {
    rl.answers.length = 0;
    rl.prompts.length = 0;
  });

  it('asks and returns the typed answer', async () => {
    const { style } = captureStyle({ interactive: true });
    rl.answers.push('Ada');

    await expect(style.ask('Name?', 'anonymous')).resolves.toBe('Ada');
    expect(rl.prompts[0].text).toContain('Name?');
    expect(rl.prompts[0].text).toContain('[anonymous]');
  });

  it('returns the fallback for an empty answer', async () => {
    const { style } = captureStyle({ interactive: true });
    rl.answers.push('   ');

    await expect(style.ask('Name?', 'anonymous')).resolves.toBe('anonymous');
  });

  it('re-prompts until an answer passes validation', async () => {
    const { style, lines } = captureStyle({ interactive: true });
    rl.answers.push('bad', 'secret');

    const answer = await style.ask('Token?', '', (value) => (value === 'secret' ? null : 'too short'));

    expect(answer).toBe('secret');
    expect(rl.prompts).toHaveLength(2);
    expect(lines).toContain('too short');
  });

  it('never hangs when stdin closes without an answer', async () => {
    const { style } = captureStyle({ interactive: true });
    rl.answers.length = 0;

    await expect(style.ask('Name?', 'fallback')).resolves.toBe('fallback');
  });

  it('hides echo for secret prompts', async () => {
    const { style } = captureStyle({ interactive: true });
    rl.answers.push('hunter2');

    await expect(style.secret('Password?')).resolves.toBe('hunter2');
    expect(rl.prompts[0].terminal).toBe(false);
  });

  it('parses confirm answers', async () => {
    const { style } = captureStyle({ interactive: true });
    rl.answers.push('yes');
    await expect(style.confirm('Proceed?')).resolves.toBe(true);

    rl.answers.push('n');
    await expect(style.confirm('Proceed?', true)).resolves.toBe(false);

    rl.answers.push('maybe', 'y');
    await expect(style.confirm('Proceed?')).resolves.toBe(true);
  });

  it('resolves choices by index and by text', async () => {
    const { style } = captureStyle({ interactive: true });

    rl.answers.push('1');
    await expect(style.choice('Pick', ['alpha', 'beta', 'gamma'])).resolves.toBe('beta');

    rl.answers.push('GAMMA');
    await expect(style.choice('Pick', ['alpha', 'beta', 'gamma'])).resolves.toBe('gamma');

    rl.answers.push('nope', '0');
    await expect(style.choice('Pick', ['alpha', 'beta'])).resolves.toBe('alpha');
  });

  it('anticipates a unique match from the typed prefix', async () => {
    const { style } = captureStyle({ interactive: true });

    rl.answers.push('pos');
    await expect(style.anticipate('Table name?', ['posts', 'users'])).resolves.toBe('posts');

    rl.answers.push('s');
    await expect(style.anticipate('Table name?', ['posts', 'users'], 'users')).resolves.toBe('users');
  });
});
