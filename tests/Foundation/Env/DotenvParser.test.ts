import { afterEach, describe, expect, it } from 'vitest';
import { DotenvParser } from '@/Foundation/Env/DotenvParser';
import { Env } from '@/Foundation/Env/Env';

const processKeys = ['PARSER_BASE', 'PARSER_LATER', 'PARSER_HOME'];

afterEach(() => {
  for (const key of processKeys) {
    Env.forget(key);
  }
});

describe('DotenvParser', () => {
  it('parses simple KEY=value entries', () => {
    expect(DotenvParser.parse('A=1\nB=two')).toEqual({ A: '1', B: 'two' });
  });

  it('ignores blank lines and whole-line comments', () => {
    const parsed = DotenvParser.parse('\n# a comment\n   # indented comment\nA=kept\n');

    expect(parsed).toEqual({ A: 'kept' });
  });

  it('tolerates spaces around the equals sign', () => {
    expect(DotenvParser.parse('KEY = value')).toEqual({ KEY: 'value' });
  });

  it('supports the export prefix', () => {
    expect(DotenvParser.parse('export KEY=value\nexport OTHER="quoted value"')).toEqual({
      KEY: 'value',
      OTHER: 'quoted value',
    });
  });

  it('keeps the last entry for duplicate keys', () => {
    expect(DotenvParser.parse('KEY=one\nKEY=two')).toEqual({ KEY: 'two' });
  });

  it('parses empty values', () => {
    expect(DotenvParser.parse('KEY=\nOTHER=""\nTHIRD=\'\'')).toEqual({ KEY: '', OTHER: '', THIRD: '' });
  });

  describe('quotes and escapes', () => {
    it('keeps whitespace inside double quotes', () => {
      expect(DotenvParser.parse('KEY=" padded value "')).toEqual({ KEY: ' padded value ' });
    });

    it('expands escape sequences in double quotes', () => {
      const parsed = DotenvParser.parse('KEY="line1\\nline2\\ttabbed"\nWIN="C:\\\\tools"');

      expect(parsed.KEY).toBe('line1\nline2\ttabbed');
      expect(parsed.WIN).toBe('C:\\tools');
    });

    it('handles escaped quotes inside double quotes', () => {
      expect(DotenvParser.parse('MSG="say \\"hi\\""')).toEqual({ MSG: 'say "hi"' });
    });

    it('treats single-quoted values as literal text', () => {
      const parsed = DotenvParser.parse("KEY='no \\n expansion'\nOTHER='C:\\new'");

      expect(parsed.KEY).toBe('no \\n expansion');
      expect(parsed.OTHER).toBe('C:\\new');
    });

    it('supports quoted values containing equals signs', () => {
      expect(DotenvParser.parse('DSN="mysql://user:pass=x@host"')).toEqual({ DSN: 'mysql://user:pass=x@host' });
    });

    it('supports multi-line quoted values', () => {
      const parsed = DotenvParser.parse('KEY="first\n# not a comment\nlast"\nNEXT=ok');

      expect(parsed.KEY).toBe('first\n# not a comment\nlast');
      expect(parsed.NEXT).toBe('ok');
    });
  });

  describe('inline comments', () => {
    it('strips comments after unquoted values', () => {
      expect(DotenvParser.parse('KEY=value # trailing comment')).toEqual({ KEY: 'value' });
    });

    it('strips comments after quoted values', () => {
      expect(DotenvParser.parse('KEY="quoted value" # trailing')).toEqual({ KEY: 'quoted value' });
      expect(DotenvParser.parse("KEY='keep # inside' # trailing")).toEqual({ KEY: 'keep # inside' });
    });

    it('keeps hash characters that are not comment starts', () => {
      expect(DotenvParser.parse('KEY=a#b')).toEqual({ KEY: 'a#b' });
      expect(DotenvParser.parse('KEY=val#ue   # comment')).toEqual({ KEY: 'val#ue' });
    });

    it('treats a comment-only value as empty', () => {
      expect(DotenvParser.parse('KEY=# nothing here')).toEqual({ KEY: '' });
    });
  });

  describe('${VAR} expansion', () => {
    it('expands references from earlier entries in the same file', () => {
      const parsed = DotenvParser.parse('PARSER_BASE=/srv\nDERIVED=${PARSER_BASE}/app');

      expect(parsed.DERIVED).toBe('/srv/app');
    });

    it('expands references from the process environment', () => {
      process.env.PARSER_HOME = '/root/orchestr';

      const parsed = DotenvParser.parse('APP_PATH=${PARSER_HOME}/app');

      expect(parsed.APP_PATH).toBe('/root/orchestr/app');
    });

    it('expands unquoted references', () => {
      const parsed = DotenvParser.parse('PARSER_LATER=value\nKEY=${PARSER_LATER}');

      expect(parsed.KEY).toBe('value');
    });

    it('expands missing references to an empty string, supports :- fallbacks', () => {
      const parsed = DotenvParser.parse('KEY=${NOPE_AT_ALL}\nOTHER=${ALSO_NOPE:-fallback value}');

      expect(parsed.KEY).toBe('');
      expect(parsed.OTHER).toBe('fallback value');
    });

    it('does not expand inside single quotes', () => {
      const parsed = DotenvParser.parse("PARSER_LATER=x\nKEY='${PARSER_LATER}'");

      expect(parsed.KEY).toBe('${PARSER_LATER}');
    });

    it('does not expand escaped references', () => {
      const parsed = DotenvParser.parse('PARSER_LATER=x\nKEY="\\${PARSER_LATER}"');

      expect(parsed.KEY).toBe('${PARSER_LATER}');
    });

    it('does not re-expand values inserted by expansion', () => {
      const parsed = DotenvParser.parse('FIRST=1\nSECOND=${FIRST}2\nTHIRD=${SECOND}3');

      expect(parsed.SECOND).toBe('12');
      expect(parsed.THIRD).toBe('123');
    });

    it('does not re-process escapes in values inserted by expansion', () => {
      const parsed = DotenvParser.parse('PATH="C:\\\\new"\nDERIVED="${PATH}\\app"');

      expect(parsed.PATH).toBe('C:\\new');
      expect(parsed.DERIVED).toBe('C:\\new\\app');
    });
  });

  it('skips lines without an equals sign and malformed keys', () => {
    const parsed = DotenvParser.parse('JUST_WORDS\n9BAD=ok\nGOOD=yes');

    expect(parsed).toEqual({ GOOD: 'yes' });
  });

  it('tolerates an unterminated quote by consuming the rest of the input', () => {
    const parsed = DotenvParser.parse('KEY="oops\nmore');

    expect(parsed.KEY).toContain('oops');
  });
});
